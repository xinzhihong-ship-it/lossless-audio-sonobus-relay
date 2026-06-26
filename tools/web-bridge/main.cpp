#include "aoo/aoo.h"
#include "aoo/aoo_net.h"
#include "aoo/aoo_pcm.h"

#include <algorithm>
#include <arpa/inet.h>
#include <atomic>
#include <chrono>
#include <cmath>
#include <csignal>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <iomanip>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <netdb.h>
#include <sstream>
#include <string>
#include <thread>
#include <unistd.h>
#include <vector>

namespace {
constexpr int kSampleRate = 48000;
constexpr int kBlockSize = 512;
constexpr int kChannels = 2;
constexpr int kBytesPerSample = 3;
constexpr int kMaxQueuedFrames = 256;
constexpr int kRelayHeaderBytes = 10;
constexpr int kMaxWebMixBlocks = 64;

struct BridgeState {
    bool connected = false;
    bool joined = false;
    std::string last_error;
    std::string joined_group;
    int peers_seen = 0;
    uint64_t web_frames_in = 0;
    uint64_t web_frames_out = 0;
    uint64_t native_frames_out = 0;
    uint64_t native_frames_in = 0;
    uint64_t relay_heartbeats = 0;
};

struct Peer {
    sockaddr_storage addr{};
    socklen_t addr_len = 0;
    std::string group;
    std::string user;
    std::string relay_source;
    std::string relay_target;
    bool relayed = false;
    int32_t local_id = 0;
    int32_t remote_source_id = AOO_ID_NONE;
    int32_t remote_sink_id = AOO_ID_NONE;
    aoo_source *source = nullptr;
    aoo_sink *sink = nullptr;
    bool source_invited = false;
    uint64_t source_packets = 0;
    uint64_t sink_packets = 0;
    uint64_t web_frames_in = 0;
    uint64_t native_frames_out = 0;
    bool connected = false;
};

struct NativeAudioFrame {
    std::string group;
    std::string user_id;
    std::string username;
    std::string stream_id;
    int sample_rate = kSampleRate;
    int bit_depth = 24;
    int channels = kChannels;
    uint64_t sequence = 0;
    uint64_t timestamp = 0;
    std::vector<uint8_t> payload;
};

struct WebMixBlock {
    std::vector<aoo_sample> left;
    std::vector<aoo_sample> right;
};

struct WebInputState {
    std::vector<aoo_sample> pending_left;
    std::vector<aoo_sample> pending_right;
    std::deque<WebMixBlock> blocks;
};

aoonet_client *g_client = nullptr;
int g_udp_socket = -1;
aoo_source *g_dummy_source = nullptr;
BridgeState g_state;
std::mutex g_state_lock;
std::mutex g_peer_lock;
std::mutex g_audio_queue_lock;
std::mutex g_web_mix_lock;
std::vector<std::unique_ptr<Peer>> g_peers;
std::deque<NativeAudioFrame> g_audio_queue;
std::map<std::string, WebInputState> g_web_inputs;
std::string g_group;
std::string g_group_password;
std::string g_username;
std::string g_relay_host;
int g_relay_port = 0;
sockaddr_storage g_relay_addr{};
socklen_t g_relay_addr_len = 0;
std::atomic<bool> g_running{true};
int32_t g_next_peer_id = 1000;
uint64_t g_next_native_sequence = 0;
uint64_t g_last_relay_heartbeat_ms = 0;

void enqueue_web_samples(const std::string& user_id, const std::vector<aoo_sample>& left, const std::vector<aoo_sample>& right, int count);
int pop_web_mix_blocks(std::vector<WebMixBlock>& blocks, int max_blocks);

int env_int(const char *name, int fallback)
{
    const char *value = std::getenv(name);
    if (!value || !*value) {
        return fallback;
    }
    return std::atoi(value);
}

std::string env_string(const char *name, const char *fallback)
{
    const char *value = std::getenv(name);
    return value && *value ? value : fallback;
}

uint64_t unix_millis()
{
    using namespace std::chrono;
    return (uint64_t)duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
}

std::string lower(std::string value)
{
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) { return (char)std::tolower(c); });
    return value;
}

std::string trim(const std::string& value)
{
    auto start = value.find_first_not_of(" \t\r\n");
    if (start == std::string::npos) {
        return "";
    }
    auto end = value.find_last_not_of(" \t\r\n");
    return value.substr(start, end - start + 1);
}

std::string json_escape(const std::string& value)
{
    std::ostringstream os;
    for (char c : value) {
        if (c == '"' || c == '\\') {
            os << '\\' << c;
        } else if (c == '\n') {
            os << "\\n";
        } else if (c == '\r') {
            os << "\\r";
        } else {
            os << c;
        }
    }
    return os.str();
}

std::string json_value(const std::string& json, const std::string& key)
{
    const std::string needle = "\"" + key + "\"";
    auto pos = json.find(needle);
    if (pos == std::string::npos) {
        return "";
    }
    pos = json.find(':', pos + needle.size());
    if (pos == std::string::npos) {
        return "";
    }
    pos = json.find('"', pos + 1);
    if (pos == std::string::npos) {
        return "";
    }
    std::string out;
    bool escaped = false;
    for (size_t i = pos + 1; i < json.size(); ++i) {
        const char c = json[i];
        if (escaped) {
            out.push_back(c);
            escaped = false;
        } else if (c == '\\') {
            escaped = true;
        } else if (c == '"') {
            return out;
        } else {
            out.push_back(c);
        }
    }
    return "";
}

void write_u16_be(std::string& out, uint16_t value)
{
    out.push_back((char)((value >> 8) & 0xff));
    out.push_back((char)(value & 0xff));
}

std::string base64_encode(const std::vector<uint8_t>& data)
{
    static const char table[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    out.reserve(((data.size() + 2) / 3) * 4);
    for (size_t i = 0; i < data.size(); i += 3) {
        uint32_t value = (uint32_t)data[i] << 16;
        if (i + 1 < data.size()) value |= (uint32_t)data[i + 1] << 8;
        if (i + 2 < data.size()) value |= (uint32_t)data[i + 2];
        out.push_back(table[(value >> 18) & 0x3f]);
        out.push_back(table[(value >> 12) & 0x3f]);
        out.push_back(i + 1 < data.size() ? table[(value >> 6) & 0x3f] : '=');
        out.push_back(i + 2 < data.size() ? table[value & 0x3f] : '=');
    }
    return out;
}

bool same_addr(const sockaddr_storage& left, const sockaddr_storage& right)
{
    if (left.ss_family != right.ss_family) {
        return false;
    }
    if (left.ss_family == AF_INET) {
        const auto *a = reinterpret_cast<const sockaddr_in *>(&left);
        const auto *b = reinterpret_cast<const sockaddr_in *>(&right);
        return a->sin_port == b->sin_port && a->sin_addr.s_addr == b->sin_addr.s_addr;
    }
    return false;
}

std::string addr_to_string(const sockaddr_storage& addr)
{
    char host[INET_ADDRSTRLEN] = {};
    if (addr.ss_family != AF_INET) {
        return "unknown";
    }
    const auto *in = reinterpret_cast<const sockaddr_in *>(&addr);
    inet_ntop(AF_INET, &in->sin_addr, host, sizeof(host));
    std::ostringstream os;
    os << host << ":" << ntohs(in->sin_port);
    return os.str();
}

void set_error(const char *message)
{
    std::lock_guard<std::mutex> lock(g_state_lock);
    g_state.last_error = message ? message : "";
}

int32_t send_to_addr(const sockaddr_storage& addr, socklen_t len, const char *data, int32_t size)
{
    if (g_udp_socket < 0 || addr.ss_family != AF_INET) {
        return -1;
    }
    return (int32_t)::sendto(g_udp_socket, data, (size_t)size, 0, reinterpret_cast<const sockaddr *>(&addr), len);
}

std::string make_relay_packet(const Peer& peer, const char *payload, int32_t payload_size, uint8_t type = 1)
{
    std::ostringstream header;
    header << "{\"group\":\"" << json_escape(g_group)
           << "\",\"source\":\"" << json_escape(g_username)
           << "\",\"target\":\"" << json_escape(peer.relay_target.empty() ? peer.user : peer.relay_target)
           << "\",\"directHost\":\"\",\"directPort\":0}";
    const std::string header_json = header.str();
    std::string packet;
    packet.reserve(kRelayHeaderBytes + header_json.size() + (size_t)payload_size);
    packet.append("SBR1", 4);
    packet.push_back(1);
    packet.push_back((char)type);
    write_u16_be(packet, (uint16_t)header_json.size());
    write_u16_be(packet, (uint16_t)payload_size);
    packet.append(header_json);
    packet.append(payload, (size_t)payload_size);
    return packet;
}

int32_t client_send(void *, const char *data, int32_t size, void *raddr)
{
    if (!raddr) {
        return -1;
    }
    const auto *addr = static_cast<const sockaddr_storage *>(raddr);
    socklen_t len = addr->ss_family == AF_INET ? sizeof(sockaddr_in) : sizeof(sockaddr_storage);
    return send_to_addr(*addr, len, data, size);
}

int32_t endpoint_send(void *endpoint, const char *data, int32_t size)
{
    auto *peer = static_cast<Peer *>(endpoint);
    if (!peer) {
        return -1;
    }
    if (peer->relayed) {
        const std::string packet = make_relay_packet(*peer, data, size, 1);
        return send_to_addr(peer->addr, peer->addr_len, packet.data(), (int32_t)packet.size());
    }
    return send_to_addr(peer->addr, peer->addr_len, data, size);
}

bool parse_relay_packet(const char *buffer, int32_t size, std::string& group, std::string& source, std::string& payload)
{
    if (size < kRelayHeaderBytes || std::memcmp(buffer, "SBR1", 4) != 0 || (uint8_t)buffer[4] != 1 || (uint8_t)buffer[5] != 1) {
        return false;
    }
    const int header_size = ((uint8_t)buffer[6] << 8) | (uint8_t)buffer[7];
    const int payload_size = ((uint8_t)buffer[8] << 8) | (uint8_t)buffer[9];
    if (size != kRelayHeaderBytes + header_size + payload_size) {
        return false;
    }
    const std::string header(buffer + kRelayHeaderBytes, (size_t)header_size);
    group = json_value(header, "group");
    source = json_value(header, "source");
    if (group.empty() || source.empty()) {
        return false;
    }
    payload.assign(buffer + kRelayHeaderBytes + header_size, (size_t)payload_size);
    return true;
}

bool resolve_udp_address(const std::string& host, int port, sockaddr_storage& out, socklen_t& out_len)
{
    addrinfo hints{};
    hints.ai_family = AF_INET;
    hints.ai_socktype = SOCK_DGRAM;
    addrinfo *result = nullptr;
    const std::string port_text = std::to_string(port);
    if (getaddrinfo(host.c_str(), port_text.c_str(), &hints, &result) != 0 || !result) {
        return false;
    }
    std::memset(&out, 0, sizeof(out));
    std::memcpy(&out, result->ai_addr, std::min<size_t>((size_t)result->ai_addrlen, sizeof(out)));
    out_len = (socklen_t)result->ai_addrlen;
    freeaddrinfo(result);
    return true;
}

bool setup_peer_audio(Peer& peer)
{
    peer.source = aoo_source_new(peer.local_id);
    peer.sink = aoo_sink_new(peer.local_id);
    if (!peer.source || !peer.sink) {
        return false;
    }
    if (!aoo_source_setup(peer.source, kSampleRate, kBlockSize, kChannels)) {
        return false;
    }
    if (!aoo_sink_setup(peer.sink, kSampleRate, kBlockSize, kChannels)) {
        return false;
    }

    aoo_format_pcm format{};
    format.header.codec = AOO_CODEC_PCM;
    format.header.blocksize = kBlockSize;
    format.header.samplerate = kSampleRate;
    format.header.nchannels = kChannels;
    format.bitdepth = AOO_PCM_INT24;
    if (!aoo_source_set_format(peer.source, reinterpret_cast<aoo_format *>(&format))) {
        return false;
    }
    aoo_source_start(peer.source);
    aoo_sink_invite_source(peer.sink, &peer, 0, endpoint_send);
    return true;
}

bool setup_dummy_source()
{
    g_dummy_source = aoo_source_new(0);
    if (!g_dummy_source) {
        return false;
    }
    if (!aoo_source_setup(g_dummy_source, kSampleRate, kBlockSize, kChannels)) {
        return false;
    }

    aoo_format_pcm format{};
    format.header.codec = AOO_CODEC_PCM;
    format.header.blocksize = kBlockSize;
    format.header.samplerate = kSampleRate;
    format.header.nchannels = kChannels;
    format.bitdepth = AOO_PCM_INT24;
    if (!aoo_source_set_format(g_dummy_source, reinterpret_cast<aoo_format *>(&format))) {
        return false;
    }
    aoo_source_start(g_dummy_source);
    return true;
}

Peer *find_peer_by_addr_locked(const sockaddr_storage& addr)
{
    for (auto& peer : g_peers) {
        if (same_addr(peer->addr, addr)) {
            return peer.get();
        }
    }
    return nullptr;
}

Peer *find_peer_by_group_user_locked(const std::string& group, const std::string& user)
{
    for (auto& peer : g_peers) {
        if (peer->group == group && peer->user == user) {
            return peer.get();
        }
    }
    return nullptr;
}

Peer *add_or_update_peer(const aoonet_client_peer_event *event)
{
    if (!event || !event->address || event->length <= 0) {
        return nullptr;
    }

    sockaddr_storage addr{};
    std::memcpy(&addr, event->address, std::min<int32_t>(event->length, (int32_t)sizeof(addr)));

    std::lock_guard<std::mutex> lock(g_peer_lock);
    if (auto *existing = find_peer_by_addr_locked(addr)) {
        existing->group = event->group ? event->group : "";
        existing->user = event->user ? event->user : "";
        existing->connected = true;
        return existing;
    }

    auto peer = std::make_unique<Peer>();
    peer->addr = addr;
    peer->addr_len = addr.ss_family == AF_INET ? sizeof(sockaddr_in) : (socklen_t)event->length;
    peer->group = event->group ? event->group : "";
    peer->user = event->user ? event->user : "";
    peer->local_id = g_next_peer_id++;
    peer->connected = true;
    if (!setup_peer_audio(*peer)) {
        set_error("failed to setup peer source/sink");
        if (peer->source) aoo_source_free(peer->source);
        if (peer->sink) aoo_sink_free(peer->sink);
        return nullptr;
    }
    std::cout << "bridge peer joined " << peer->user << " at " << addr_to_string(peer->addr)
              << " localId=" << peer->local_id << "\n";
    g_peers.push_back(std::move(peer));
    return g_peers.back().get();
}

Peer *add_or_update_relay_peer(const aoonet_client_peer_event *event)
{
    if (!event || !event->group || !event->user || g_relay_addr_len <= 0) {
        return nullptr;
    }
    const std::string group = event->group;
    const std::string user = event->user;
    if (user == g_username) {
        return nullptr;
    }

    std::lock_guard<std::mutex> lock(g_peer_lock);
    if (auto *existing = find_peer_by_group_user_locked(group, user)) {
        existing->connected = true;
        return existing;
    }

    auto peer = std::make_unique<Peer>();
    peer->addr = g_relay_addr;
    peer->addr_len = g_relay_addr_len;
    peer->group = group;
    peer->user = user;
    peer->relay_source = g_username;
    peer->relay_target = user;
    peer->relayed = true;
    peer->local_id = g_next_peer_id++;
    peer->connected = true;
    if (!setup_peer_audio(*peer)) {
        set_error("failed to setup relayed peer source/sink");
        if (peer->source) aoo_source_free(peer->source);
        if (peer->sink) aoo_sink_free(peer->sink);
        return nullptr;
    }
    const std::string registration = make_relay_packet(*peer, "", 0, 0);
    send_to_addr(peer->addr, peer->addr_len, registration.data(), (int32_t)registration.size());
    aoo_sink_invite_source(peer->sink, peer.get(), 0, endpoint_send);
    std::cout << "bridge relayed peer prejoin " << peer->user << " via " << addr_to_string(peer->addr)
              << " localId=" << peer->local_id << "\n";
    g_peers.push_back(std::move(peer));
    return g_peers.back().get();
}

int32_t handle_client_events(void *, const aoo_event **events, int32_t n)
{
    for (int32_t i = 0; i < n; ++i) {
        switch (events[i]->type) {
        case AOONET_CLIENT_CONNECT_EVENT: {
            auto *event = (aoonet_client_event *)events[i];
            {
                std::lock_guard<std::mutex> lock(g_state_lock);
                g_state.connected = event->result > 0;
                if (!g_state.connected) {
                    g_state.last_error = event->errormsg ? event->errormsg : "connect failed";
                }
            }
            if (event->result > 0 && g_client) {
                aoonet_client_group_join(g_client, g_group.c_str(), g_group_password.c_str());
            }
            break;
        }
        case AOONET_CLIENT_DISCONNECT_EVENT: {
            auto *event = (aoonet_client_event *)events[i];
            std::lock_guard<std::mutex> lock(g_state_lock);
            g_state.connected = false;
            g_state.joined = false;
            if (event->errormsg) {
                g_state.last_error = event->errormsg;
            }
            break;
        }
        case AOONET_CLIENT_GROUP_JOIN_EVENT: {
            auto *event = (aoonet_client_group_event *)events[i];
            std::lock_guard<std::mutex> lock(g_state_lock);
            g_state.joined = event->result > 0;
            g_state.joined_group = event->name ? event->name : "";
            if (!g_state.joined) {
                g_state.last_error = event->errormsg ? event->errormsg : "group join failed";
            }
            break;
        }
        case AOONET_CLIENT_GROUP_LEAVE_EVENT: {
            std::lock_guard<std::mutex> lock(g_state_lock);
            g_state.joined = false;
            g_state.joined_group.clear();
            break;
        }
        case AOONET_CLIENT_PEER_PREJOIN_EVENT:
        case AOONET_CLIENT_PEER_JOIN_EVENT: {
            auto *event = (aoonet_client_peer_event *)events[i];
            if (events[i]->type == AOONET_CLIENT_PEER_PREJOIN_EVENT) {
                add_or_update_relay_peer(event);
            } else {
                add_or_update_peer(event);
            }
            std::lock_guard<std::mutex> lock(g_state_lock);
            g_state.peers_seen += 1;
            break;
        }
        case AOONET_CLIENT_PEER_LEAVE_EVENT: {
            auto *event = (aoonet_client_peer_event *)events[i];
            sockaddr_storage addr{};
            if (event->address && event->length > 0) {
                std::memcpy(&addr, event->address, std::min<int32_t>(event->length, (int32_t)sizeof(addr)));
                std::lock_guard<std::mutex> lock(g_peer_lock);
                if (auto *peer = find_peer_by_addr_locked(addr)) {
                    peer->connected = false;
                }
            }
            break;
        }
        default:
            break;
        }
    }
    return 1;
}

int32_t handle_source_events(void *user, const aoo_event **events, int32_t n)
{
    auto *peer = static_cast<Peer *>(user);
    if (!peer) {
        return 1;
    }
    for (int32_t i = 0; i < n; ++i) {
        switch (events[i]->type) {
        case AOO_INVITE_EVENT: {
            auto *event = (aoo_sink_event *)events[i];
            peer->remote_sink_id = event->id;
            aoo_source_add_sink(peer->source, event->endpoint, peer->remote_sink_id, endpoint_send);
            aoo_source_set_sinkoption(peer->source, event->endpoint, peer->remote_sink_id, aoo_opt_protocol_flags, &event->flags, sizeof(int32_t));
            aoo_source_start(peer->source);
            peer->source_invited = true;
            peer->connected = true;
            break;
        }
        case AOO_UNINVITE_EVENT: {
            auto *event = (aoo_sink_event *)events[i];
            aoo_source_remove_sink(peer->source, event->endpoint, event->id);
            break;
        }
        default:
            break;
        }
    }
    return 1;
}

int32_t handle_dummy_source_events(void *, const aoo_event **events, int32_t n)
{
    for (int32_t i = 0; i < n; ++i) {
        switch (events[i]->type) {
        case AOO_INVITE_EVENT: {
            auto *event = (aoo_sink_event *)events[i];
            auto *peer = static_cast<Peer *>(event->endpoint);
            if (!peer || !peer->source || !peer->sink) {
                break;
            }
            peer->remote_sink_id = event->id;
            aoo_source_add_sink(peer->source, peer, peer->remote_sink_id, endpoint_send);
            aoo_source_set_sinkoption(peer->source, peer, peer->remote_sink_id, aoo_opt_protocol_flags, &event->flags, sizeof(int32_t));
            aoo_source_start(peer->source);
            peer->source_invited = true;
            peer->connected = true;
            peer->remote_source_id = peer->remote_sink_id;
            aoo_sink_uninvite_source(peer->sink, peer, 0, endpoint_send);
            aoo_sink_invite_source(peer->sink, peer, peer->remote_source_id, endpoint_send);
            if (g_dummy_source) {
                aoo_source_remove_sink(g_dummy_source, peer, event->id);
            }
            std::cout << "bridge dummy handshake with " << peer->user
                      << " remoteSinkId=" << peer->remote_sink_id
                      << " localId=" << peer->local_id << "\n";
            break;
        }
        case AOO_UNINVITE_EVENT: {
            auto *event = (aoo_sink_event *)events[i];
            if (g_dummy_source) {
                aoo_source_remove_sink(g_dummy_source, event->endpoint, event->id);
            }
            break;
        }
        default:
            break;
        }
    }
    return 1;
}

int32_t handle_sink_events(void *user, const aoo_event **events, int32_t n)
{
    auto *peer = static_cast<Peer *>(user);
    if (!peer) {
        return 1;
    }
    for (int32_t i = 0; i < n; ++i) {
        switch (events[i]->type) {
        case AOO_SOURCE_ADD_EVENT: {
            auto *event = (aoo_source_event *)events[i];
            if (event->id != 0) {
                peer->remote_source_id = event->id;
                aoo_sink_uninvite_source(peer->sink, event->endpoint, 0, endpoint_send);
                aoo_sink_invite_source(peer->sink, event->endpoint, peer->remote_source_id, endpoint_send);
                peer->connected = true;
            }
            break;
        }
        default:
            break;
        }
    }
    return 1;
}

std::string status_json()
{
    BridgeState state;
    {
        std::lock_guard<std::mutex> lock(g_state_lock);
        state = g_state;
    }
    size_t peer_count = 0;
    std::vector<Peer> peers;
    {
        std::lock_guard<std::mutex> lock(g_peer_lock);
        peer_count = g_peers.size();
        for (const auto& peer : g_peers) {
            peers.push_back(*peer);
        }
    }
    size_t queued = 0;
    {
        std::lock_guard<std::mutex> lock(g_audio_queue_lock);
        queued = g_audio_queue.size();
    }
    size_t queued_web = 0;
    {
        std::lock_guard<std::mutex> lock(g_web_mix_lock);
        for (const auto& entry : g_web_inputs) {
            queued_web += entry.second.blocks.size();
        }
    }
    std::ostringstream os;
    os << "{"
       << "\"ok\":true,"
       << "\"connected\":" << (state.connected ? "true" : "false") << ","
       << "\"joined\":" << (state.joined ? "true" : "false") << ","
       << "\"group\":\"" << json_escape(state.joined_group) << "\","
       << "\"peersSeen\":" << state.peers_seen << ","
       << "\"activePeers\":" << peer_count << ","
       << "\"webFramesIn\":" << state.web_frames_in << ","
       << "\"webFramesOut\":" << state.web_frames_out << ","
       << "\"nativeFramesIn\":" << state.native_frames_in << ","
       << "\"nativeFramesOut\":" << state.native_frames_out << ","
       << "\"relayHeartbeats\":" << state.relay_heartbeats << ","
       << "\"queuedNativeFrames\":" << queued << ","
       << "\"queuedWebBlocks\":" << queued_web << ","
       << "\"lastError\":\"" << json_escape(state.last_error) << "\","
       << "\"peers\":[";
    for (size_t i = 0; i < peers.size(); ++i) {
        const auto& peer = peers[i];
        if (i) os << ",";
        os << "{"
           << "\"group\":\"" << json_escape(peer.group) << "\","
           << "\"user\":\"" << json_escape(peer.user) << "\","
           << "\"relayed\":" << (peer.relayed ? "true" : "false") << ","
           << "\"connected\":" << (peer.connected ? "true" : "false") << ","
           << "\"sourceInvited\":" << (peer.source_invited ? "true" : "false") << ","
           << "\"sourcePackets\":" << peer.source_packets << ","
           << "\"sinkPackets\":" << peer.sink_packets << ","
           << "\"webFramesIn\":" << peer.web_frames_in << ","
           << "\"nativeFramesOut\":" << peer.native_frames_out << ","
           << "\"remoteSourceId\":" << peer.remote_source_id << ","
           << "\"remoteSinkId\":" << peer.remote_sink_id
           << "}";
    }
    os << "]"
       << "}";
    return os.str();
}

void write_response(int client, int status, const std::string& body, const std::string& content_type = "application/json; charset=utf-8")
{
    const char *status_text = status == 200 ? "OK" : status == 204 ? "No Content" : "Error";
    std::ostringstream response;
    response << "HTTP/1.1 " << status << " " << status_text << "\r\n"
             << "Content-Type: " << content_type << "\r\n"
             << "Content-Length: " << body.size() << "\r\n"
             << "Connection: close\r\n\r\n"
             << body;
    auto text = response.str();
    send(client, text.data(), text.size(), 0);
}

int header_int(const std::map<std::string, std::string>& headers, const std::string& name, int fallback)
{
    auto it = headers.find(lower(name));
    if (it == headers.end()) {
        return fallback;
    }
    return std::atoi(it->second.c_str());
}

std::string header_string(const std::map<std::string, std::string>& headers, const std::string& name, const std::string& fallback = "")
{
    auto it = headers.find(lower(name));
    return it == headers.end() ? fallback : it->second;
}

void process_web_pcm(const std::string& body, const std::map<std::string, std::string>& headers)
{
    const int sample_rate = header_int(headers, "x-sample-rate", kSampleRate);
    const int bit_depth = header_int(headers, "x-bit-depth", 24);
    const int channels = header_int(headers, "x-channels", kChannels);
    const std::string user_id = header_string(headers, "x-user-id", "anonymous-web");
    if (sample_rate != kSampleRate || (bit_depth != 16 && bit_depth != 24) || (channels != 1 && channels != 2) || body.empty()) {
        return;
    }

    const int input_bytes_per_sample = bit_depth == 24 ? 3 : 2;
    const int frames = (int)body.size() / (input_bytes_per_sample * channels);
    for (int offset = 0; offset < frames;) {
        std::vector<aoo_sample> input_left(kBlockSize, 0.0f);
        std::vector<aoo_sample> input_right(kBlockSize, 0.0f);
        const int count = std::min(kBlockSize, frames - offset);
        for (int i = 0; i < count; ++i) {
            float samples[kChannels] = { 0.0f, 0.0f };
            for (int channel = 0; channel < channels; ++channel) {
                const int byte_offset = ((offset + i) * channels + channel) * input_bytes_per_sample;
                float sample = 0.0f;
                if (bit_depth == 24) {
                    const uint8_t b0 = (uint8_t)body[byte_offset];
                    const uint8_t b1 = (uint8_t)body[byte_offset + 1];
                    const uint8_t b2 = (uint8_t)body[byte_offset + 2];
                    int32_t value = (int32_t)((uint32_t)b0 | ((uint32_t)b1 << 8) | ((uint32_t)b2 << 16));
                    if (value & 0x800000) {
                        value |= ~0xFFFFFF;
                    }
                    sample = std::max(-1.0f, std::min(1.0f, (float)value / 8388608.0f));
                } else {
                    const uint8_t lo = (uint8_t)body[byte_offset];
                    const uint8_t hi = (uint8_t)body[byte_offset + 1];
                    const int16_t value = (int16_t)((uint16_t)lo | ((uint16_t)hi << 8));
                    sample = std::max(-1.0f, std::min(1.0f, (float)value / 32768.0f));
                }
                samples[channel] = sample;
            }
            input_left[i] = samples[0];
            input_right[i] = channels > 1 ? samples[1] : samples[0];
        }
        enqueue_web_samples(user_id, input_left, input_right, count);
        {
            std::lock_guard<std::mutex> state_lock(g_state_lock);
            g_state.web_frames_in += 1;
        }
        offset += count;
    }
}

std::string drain_audio_json(int max_frames)
{
    std::deque<NativeAudioFrame> frames;
    {
        std::lock_guard<std::mutex> lock(g_audio_queue_lock);
        while (!g_audio_queue.empty() && (int)frames.size() < max_frames) {
            frames.push_back(std::move(g_audio_queue.front()));
            g_audio_queue.pop_front();
        }
    }
    std::ostringstream os;
    os << "{\"frames\":[";
    for (size_t i = 0; i < frames.size(); ++i) {
        const auto& frame = frames[i];
        if (i) os << ",";
        os << "{"
           << "\"group\":\"" << json_escape(frame.group) << "\","
           << "\"userId\":\"" << json_escape(frame.user_id) << "\","
           << "\"username\":\"" << json_escape(frame.username) << "\","
           << "\"streamId\":\"" << json_escape(frame.stream_id) << "\","
           << "\"sampleRate\":" << frame.sample_rate << ","
           << "\"bitDepth\":" << frame.bit_depth << ","
           << "\"channels\":" << frame.channels << ","
           << "\"sequence\":" << frame.sequence << ","
           << "\"timestamp\":" << frame.timestamp << ","
           << "\"payload\":\"" << base64_encode(frame.payload) << "\""
           << "}";
    }
    os << "]}";
    return os.str();
}

void enqueue_web_samples(const std::string& user_id, const std::vector<aoo_sample>& left, const std::vector<aoo_sample>& right, int count)
{
    std::lock_guard<std::mutex> lock(g_web_mix_lock);
    auto& input = g_web_inputs[user_id.empty() ? "anonymous-web" : user_id];
    for (int i = 0; i < count; ++i) {
        input.pending_left.push_back(left[i]);
        input.pending_right.push_back(right[i]);
    }
    while ((int)input.pending_left.size() >= kBlockSize && (int)input.pending_right.size() >= kBlockSize) {
        WebMixBlock block;
        block.left.assign(input.pending_left.begin(), input.pending_left.begin() + kBlockSize);
        block.right.assign(input.pending_right.begin(), input.pending_right.begin() + kBlockSize);
        input.pending_left.erase(input.pending_left.begin(), input.pending_left.begin() + kBlockSize);
        input.pending_right.erase(input.pending_right.begin(), input.pending_right.begin() + kBlockSize);
        if (input.blocks.size() >= kMaxWebMixBlocks) {
            input.blocks.pop_front();
        }
        input.blocks.push_back(std::move(block));
    }
}

int pop_web_mix_blocks(std::vector<WebMixBlock>& blocks, int max_blocks)
{
    std::lock_guard<std::mutex> lock(g_web_mix_lock);
    blocks.clear();
    for (auto it = g_web_inputs.begin(); it != g_web_inputs.end() && (int)blocks.size() < max_blocks;) {
        auto& input = it->second;
        if (!input.blocks.empty()) {
            blocks.push_back(std::move(input.blocks.front()));
            input.blocks.pop_front();
        }
        if (input.blocks.empty() && input.pending_left.empty() && input.pending_right.empty()) {
            it = g_web_inputs.erase(it);
        } else {
            ++it;
        }
    }
    return (int)blocks.size();
}

void handle_http_client(int client)
{
    std::string request;
    char chunk[4096];
    while (request.find("\r\n\r\n") == std::string::npos) {
        auto n = recv(client, chunk, sizeof(chunk), 0);
        if (n <= 0) return;
        request.append(chunk, (size_t)n);
        if (request.size() > 2 * 1024 * 1024) return;
    }

    const auto header_end = request.find("\r\n\r\n");
    auto first_line_end = request.find("\r\n");
    auto first_line = request.substr(0, first_line_end);
    std::istringstream line(first_line);
    std::string method;
    std::string path;
    line >> method >> path;
    const auto query_pos = path.find('?');
    const std::string route = query_pos == std::string::npos ? path : path.substr(0, query_pos);

    std::map<std::string, std::string> headers;
    size_t pos = first_line_end + 2;
    while (pos < header_end) {
        auto next = request.find("\r\n", pos);
        auto sep = request.find(':', pos);
        if (sep != std::string::npos && sep < next) {
            headers[lower(trim(request.substr(pos, sep - pos)))] = trim(request.substr(sep + 1, next - sep - 1));
        }
        pos = next + 2;
    }

    const int content_length = header_int(headers, "content-length", 0);
    while ((int)(request.size() - header_end - 4) < content_length) {
        auto n = recv(client, chunk, sizeof(chunk), 0);
        if (n <= 0) return;
        request.append(chunk, (size_t)n);
        if (request.size() > 2 * 1024 * 1024) return;
    }
    const std::string body = request.substr(header_end + 4, content_length);

    if (method == "GET" && route == "/health") {
        write_response(client, 200, "{\"ok\":true}");
    } else if (method == "GET" && route == "/status") {
        write_response(client, 200, status_json());
    } else if (method == "POST" && route == "/audio/pcm") {
        process_web_pcm(body, headers);
        write_response(client, 204, "");
    } else if (method == "GET" && route == "/audio/pcm") {
        write_response(client, 200, drain_audio_json(32));
    } else {
        write_response(client, 404, "{\"error\":\"not found\"}");
    }
}

void admin_thread(int port)
{
    int server = socket(AF_INET, SOCK_STREAM, 0);
    int yes = 1;
    setsockopt(server, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes));

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = INADDR_ANY;
    addr.sin_port = htons((uint16_t)port);
    if (bind(server, (sockaddr *)&addr, sizeof(addr)) < 0 || listen(server, 16) < 0) {
        std::cerr << "web bridge admin listen failed on :" << port << "\n";
        return;
    }

    while (g_running.load()) {
        int client = accept(server, nullptr, nullptr);
        if (client >= 0) {
            handle_http_client(client);
            close(client);
        }
    }
    close(server);
}

void dispatch_udp_message(const char *buffer, int32_t n, const sockaddr_storage& remote)
{
    std::string relay_group;
    std::string relay_source;
    std::string relay_payload;
    if (parse_relay_packet(buffer, n, relay_group, relay_source, relay_payload)) {
        std::lock_guard<std::mutex> lock(g_peer_lock);
        Peer *relay_peer = find_peer_by_group_user_locked(relay_group, relay_source);
        if (!relay_peer && g_relay_addr_len > 0) {
            auto peer = std::make_unique<Peer>();
            peer->addr = g_relay_addr;
            peer->addr_len = g_relay_addr_len;
            peer->group = relay_group;
            peer->user = relay_source;
            peer->relay_source = g_username;
            peer->relay_target = relay_source;
            peer->relayed = true;
            peer->local_id = g_next_peer_id++;
            peer->connected = true;
            if (!setup_peer_audio(*peer)) {
                set_error("failed to setup relayed source peer");
                if (peer->source) aoo_source_free(peer->source);
                if (peer->sink) aoo_sink_free(peer->sink);
                return;
            }
            g_peers.push_back(std::move(peer));
            relay_peer = g_peers.back().get();
        }
        if (!relay_peer || relay_payload.empty()) {
            return;
        }
        int32_t relay_type = 0;
        int32_t relay_id = AOO_ID_NONE;
        if (aoo_parse_pattern(relay_payload.data(), (int32_t)relay_payload.size(), &relay_type, &relay_id) <= 0) {
            return;
        }
        if (relay_type == AOO_TYPE_SINK) {
            if (relay_peer->sink) {
                aoo_sink_handle_message(relay_peer->sink, relay_payload.data(), (int32_t)relay_payload.size(), relay_peer, endpoint_send);
                relay_peer->sink_packets += 1;
            }
        } else if (relay_type == AOO_TYPE_SOURCE) {
            if (relay_id == 0 && g_dummy_source) {
                aoo_source_handle_message(g_dummy_source, relay_payload.data(), (int32_t)relay_payload.size(), relay_peer, endpoint_send);
            } else if (relay_peer->source) {
                aoo_source_handle_message(relay_peer->source, relay_payload.data(), (int32_t)relay_payload.size(), relay_peer, endpoint_send);
                relay_peer->source_packets += 1;
            }
        }
        return;
    }

    int32_t type = 0;
    int32_t id = AOO_ID_NONE;
    if (aoo_parse_pattern(buffer, n, &type, &id) > 0) {
        std::lock_guard<std::mutex> lock(g_peer_lock);
        Peer *source_peer = find_peer_by_addr_locked(remote);
        if (!source_peer) {
            return;
        }
        if (type == AOO_TYPE_SINK) {
            for (auto& peer : g_peers) {
                if (!peer->sink) continue;
                int32_t local_id = AOO_ID_NONE;
                aoo_sink_get_id(peer->sink, &local_id);
                if (id == AOO_ID_NONE || id == AOO_ID_WILDCARD || id == local_id) {
                    if (aoo_sink_handle_message(peer->sink, buffer, n, peer.get(), endpoint_send)) {
                        peer->sink_packets += 1;
                    }
                    if (id != AOO_ID_WILDCARD && id != AOO_ID_NONE) break;
                }
            }
        } else if (type == AOO_TYPE_SOURCE) {
            if (id == 0 && g_dummy_source) {
                aoo_source_handle_message(g_dummy_source, buffer, n, source_peer, endpoint_send);
                return;
            }
            for (auto& peer : g_peers) {
                if (!peer->source) continue;
                int32_t local_id = AOO_ID_NONE;
                aoo_source_get_id(peer->source, &local_id);
                if (id == AOO_ID_WILDCARD || id == local_id) {
                    if (aoo_source_handle_message(peer->source, buffer, n, peer.get(), endpoint_send)) {
                        peer->source_packets += 1;
                    }
                    if (id != AOO_ID_WILDCARD) break;
                }
            }
        }
        return;
    }

    if (aoonet_parse_pattern(buffer, n, &type) > 0 && (type == AOO_TYPE_CLIENT || type == AOO_TYPE_PEER) && g_client) {
        aoonet_client_handle_message(g_client, buffer, n, (void *)&remote);
    }
}

void udp_receive_thread()
{
    char buffer[AOO_MAXPACKETSIZE];
    while (g_running.load()) {
        sockaddr_storage remote{};
        socklen_t remote_len = sizeof(remote);
        auto n = recvfrom(g_udp_socket, buffer, sizeof(buffer), 0, (sockaddr *)&remote, &remote_len);
        if (n > 0) {
            dispatch_udp_message(buffer, (int32_t)n, remote);
        }
    }
}

void enqueue_native_audio(Peer& peer, const std::vector<aoo_sample>& left, const std::vector<aoo_sample>& right)
{
    NativeAudioFrame frame;
    frame.group = g_group;
    frame.user_id = "sonobus-" + (peer.user.empty() ? std::to_string(peer.local_id) : peer.user);
    frame.username = peer.user.empty() ? frame.user_id : peer.user;
    frame.stream_id = frame.user_id + "-native";
    frame.sequence = g_next_native_sequence++;
    frame.timestamp = unix_millis();
    const size_t sample_count = std::min(left.size(), right.size());
    frame.payload.resize(sample_count * kChannels * kBytesPerSample);
    for (size_t i = 0; i < sample_count; ++i) {
        const aoo_sample channel_values[kChannels] = { left[i], right[i] };
        for (int channel = 0; channel < kChannels; ++channel) {
            const float clamped = std::max(-1.0f, std::min(1.0f, channel_values[channel]));
            const int32_t value = std::max(-8388608, std::min(8388607, (int)std::lrintf(clamped * 8388607.0f)));
            const size_t byte_offset = (i * kChannels + channel) * kBytesPerSample;
            frame.payload[byte_offset] = (uint8_t)(value & 0xff);
            frame.payload[byte_offset + 1] = (uint8_t)((value >> 8) & 0xff);
            frame.payload[byte_offset + 2] = (uint8_t)((value >> 16) & 0xff);
        }
    }
    {
        std::lock_guard<std::mutex> lock(g_audio_queue_lock);
        if (g_audio_queue.size() >= kMaxQueuedFrames) {
            g_audio_queue.pop_front();
        }
        g_audio_queue.push_back(std::move(frame));
    }
    peer.native_frames_out += 1;
    {
        std::lock_guard<std::mutex> state_lock(g_state_lock);
        g_state.native_frames_out += 1;
    }
}

void pump_thread()
{
    std::vector<aoo_sample> sink_left(kBlockSize, 0.0f);
    std::vector<aoo_sample> sink_right(kBlockSize, 0.0f);
    std::vector<aoo_sample> web_mix_left(kBlockSize, 0.0f);
    std::vector<aoo_sample> web_mix_right(kBlockSize, 0.0f);
    std::vector<WebMixBlock> web_blocks;
    aoo_sample *sink_channels[kChannels] = { sink_left.data(), sink_right.data() };
    while (g_running.load()) {
        if (g_client) {
            aoonet_client_send(g_client);
            aoonet_client_handle_events(g_client, handle_client_events, nullptr);
        }
        {
            std::lock_guard<std::mutex> lock(g_peer_lock);
            const uint64_t now_ms = unix_millis();
            if (g_relay_addr_len > 0 && now_ms - g_last_relay_heartbeat_ms > 5000) {
                for (auto& peer : g_peers) {
                    if (!peer->relayed) continue;
                    const std::string registration = make_relay_packet(*peer, "", 0, 0);
                    send_to_addr(peer->addr, peer->addr_len, registration.data(), (int32_t)registration.size());
                }
                g_last_relay_heartbeat_ms = now_ms;
                std::lock_guard<std::mutex> state_lock(g_state_lock);
                g_state.relay_heartbeats += 1;
            }
            if (g_dummy_source) {
                aoo_source_send(g_dummy_source);
                aoo_source_handle_events(g_dummy_source, handle_dummy_source_events, nullptr);
            }
            std::fill(web_mix_left.begin(), web_mix_left.end(), 0.0f);
            std::fill(web_mix_right.begin(), web_mix_right.end(), 0.0f);
            const int mixed_blocks = pop_web_mix_blocks(web_blocks, 64);
            for (const auto& block : web_blocks) {
                for (int i = 0; i < kBlockSize; ++i) {
                    web_mix_left[i] += block.left[i];
                    web_mix_right[i] += block.right[i];
                }
            }
            if (mixed_blocks > 0) {
                const float gain = mixed_blocks > 1 ? 1.0f / std::sqrt((float)mixed_blocks) : 1.0f;
                for (int i = 0; i < kBlockSize; ++i) {
                    web_mix_left[i] = std::max(-1.0f, std::min(1.0f, web_mix_left[i] * gain));
                    web_mix_right[i] = std::max(-1.0f, std::min(1.0f, web_mix_right[i] * gain));
                }
                const aoo_sample *web_channels[kChannels] = { web_mix_left.data(), web_mix_right.data() };
                const auto sample_time = aoo_osctime_get();
                for (auto& peer : g_peers) {
                    if (!peer->source || !peer->connected || !peer->source_invited) {
                        continue;
                    }
                    aoo_source_process(peer->source, web_channels, kBlockSize, sample_time);
                    peer->web_frames_in += 1;
                    std::lock_guard<std::mutex> state_lock(g_state_lock);
                    g_state.web_frames_out += 1;
                }
            }
            for (auto& peer : g_peers) {
                if (peer->source) {
                    aoo_source_send(peer->source);
                    aoo_source_handle_events(peer->source, handle_source_events, peer.get());
                }
                if (peer->sink) {
                    aoo_sink_send(peer->sink);
                    aoo_sink_handle_events(peer->sink, handle_sink_events, peer.get());
                    std::fill(sink_left.begin(), sink_left.end(), 0.0f);
                    std::fill(sink_right.begin(), sink_right.end(), 0.0f);
                    if (aoo_sink_process(peer->sink, sink_channels, kBlockSize, aoo_osctime_get()) > 0) {
                        peer->native_frames_out += 1;
                        {
                            std::lock_guard<std::mutex> state_lock(g_state_lock);
                            g_state.native_frames_in += 1;
                        }
                        enqueue_native_audio(*peer, sink_left, sink_right);
                    }
                }
            }
        }
        usleep(10 * 1000);
    }
}

void signal_handler(int)
{
    g_running.store(false);
    if (g_client) {
        aoonet_client_quit(g_client);
    }
}
}

int main()
{
    const auto connection_host = env_string("BRIDGE_CONNECTION_HOST", "connection-server");
    const auto group = env_string("BRIDGE_GROUP", "web");
    const auto username = env_string("BRIDGE_USERNAME", "web-bridge");
    const auto password = env_string("BRIDGE_PASSWORD", "");
    const auto group_password = env_string("BRIDGE_GROUP_PASSWORD", "");
    g_group = group;
    g_group_password = group_password;
    g_username = username;
    int connection_port = env_int("BRIDGE_CONNECTION_PORT", 10998);
    int udp_port = env_int("BRIDGE_UDP_PORT", 0);
    int admin_port = env_int("BRIDGE_ADMIN_PORT", 18100);
    g_relay_host = env_string("BRIDGE_RELAY_HOST", "");
    g_relay_port = env_int("BRIDGE_RELAY_PORT", 0);

    aoo_initialize();

    g_udp_socket = socket(AF_INET, SOCK_DGRAM, 0);
    if (g_udp_socket < 0) {
        std::cerr << "failed to create UDP socket\n";
        return 1;
    }

    sockaddr_in udp_addr{};
    udp_addr.sin_family = AF_INET;
    udp_addr.sin_addr.s_addr = INADDR_ANY;
    udp_addr.sin_port = htons((uint16_t)udp_port);
    if (bind(g_udp_socket, (sockaddr *)&udp_addr, sizeof(udp_addr)) < 0) {
        std::cerr << "failed to bind UDP socket on :" << udp_port << "\n";
        close(g_udp_socket);
        return 1;
    }
    sockaddr_in bound_addr{};
    socklen_t bound_len = sizeof(bound_addr);
    if (getsockname(g_udp_socket, (sockaddr *)&bound_addr, &bound_len) == 0) {
        udp_port = ntohs(bound_addr.sin_port);
    }
    if (!g_relay_host.empty() && g_relay_port > 0) {
        if (!resolve_udp_address(g_relay_host, g_relay_port, g_relay_addr, g_relay_addr_len)) {
            std::cerr << "failed to resolve relay " << g_relay_host << ":" << g_relay_port << "\n";
            close(g_udp_socket);
            return 1;
        }
    }

    g_client = aoonet_client_new(nullptr, client_send, udp_port);
    if (!g_client) {
        std::cerr << "failed to create AoO client\n";
        close(g_udp_socket);
        return 1;
    }
    if (!setup_dummy_source()) {
        std::cerr << "failed to create AoO dummy source\n";
        aoonet_client_free(g_client);
        close(g_udp_socket);
        return 1;
    }

    std::signal(SIGTERM, signal_handler);
    std::signal(SIGINT, signal_handler);

    std::thread admin(admin_thread, admin_port);
    admin.detach();
    std::thread udp_receiver(udp_receive_thread);
    udp_receiver.detach();
    std::thread pump(pump_thread);
    pump.detach();

    std::cout << "SonoBus web bridge connecting to " << connection_host << ":" << connection_port
              << " as " << username << ", group " << group << ", admin :" << admin_port
              << ", udp :" << udp_port;
    if (g_relay_addr_len > 0) {
        std::cout << ", relay " << g_relay_host << ":" << g_relay_port;
    }
    std::cout << "\n";

    aoonet_client_connect(g_client, connection_host.c_str(), connection_port, username.c_str(), password.c_str());
    auto result = aoonet_client_run(g_client);
    g_running.store(false);
    aoonet_client_free(g_client);
    g_client = nullptr;
    if (g_dummy_source) {
        aoo_source_free(g_dummy_source);
        g_dummy_source = nullptr;
    }
    {
        std::lock_guard<std::mutex> lock(g_peer_lock);
        for (auto& peer : g_peers) {
            if (peer->source) aoo_source_free(peer->source);
            if (peer->sink) aoo_sink_free(peer->sink);
        }
        g_peers.clear();
    }
    close(g_udp_socket);
    aoo_terminate();
    return result;
}
