#include "Protocol.h"
#include <monocypher.h>
#include <algorithm>
#include <bit>
#include <cmath>
#include <cstring>
#include <cstdlib>
#include <stdexcept>
#if defined(_WIN32)
#include <windows.h>
#include <bcrypt.h>
#elif !defined(__APPLE__)
#include <sys/random.h>
#endif

namespace sharestream {
void randomBytes(void* p, size_t n) {
#if defined(_WIN32)
    if (BCryptGenRandom(nullptr,static_cast<PUCHAR>(p),static_cast<ULONG>(n),BCRYPT_USE_SYSTEM_PREFERRED_RNG)!=0)
        throw std::runtime_error("OS random source unavailable");
#elif defined(__APPLE__)
    arc4random_buf(p, n);
#else
    auto* out = static_cast<uint8_t*>(p);
    while (n) {
        auto got = getrandom(out, n, 0);
        if (got <= 0) throw std::runtime_error("OS random source unavailable");
        out += got; n -= static_cast<size_t>(got);
    }
#endif
}
std::string newRoomCode() {
    Id bytes {}; randomBytes(bytes.data(), bytes.size());
    constexpr char digits[] = "0123456789abcdef";
    std::string code;
    for (auto b : bytes) { code += digits[b >> 4]; code += digits[b & 15]; }
    return code;
}
std::optional<Room> parseRoom(const std::string& text) {
    std::string code;
    for (char c : text) if (c != '-' && c != ' ') code += c;
    if (code.size() != 32) return {};
    auto digit = [](char c) { if(c >= '0' && c <= '9') return c-'0'; if(c >= 'a' && c <= 'f') return c-'a'+10; if(c >= 'A' && c <= 'F') return c-'A'+10; return -1; };
    Id secret {};
    for (size_t i = 0; i < secret.size(); ++i) {
        const int a = digit(code[2*i]), b = digit(code[2*i+1]);
        if (a < 0 || b < 0) return {};
        secret[i] = static_cast<uint8_t>((a << 4) | b);
    }
    Room room {};
    constexpr char keyLabel[] = "ShareStream v1 audio encryption";
    constexpr char idLabel[] = "ShareStream v1 relay routing";
    crypto_blake2b_keyed(room.key.data(), room.key.size(), secret.data(), secret.size(), reinterpret_cast<const uint8_t*>(keyLabel), sizeof(keyLabel)-1);
    crypto_blake2b_keyed(room.id.data(), room.id.size(), secret.data(), secret.size(), reinterpret_cast<const uint8_t*>(idLabel), sizeof(idLabel)-1);
    crypto_wipe(secret.data(), secret.size());
    return room;
}
void writeHeader(uint8_t* out, const Header& h) {
    std::memcpy(out, "SST1", 4); out[4] = static_cast<uint8_t>(h.kind); out[5] = static_cast<uint8_t>(h.role);
    out[6] = out[7] = 0;
    std::copy(h.room.begin(), h.room.end(), out+8);
    std::copy(h.peer.begin(), h.peer.end(), out+24);
    for (int i = 0; i < 8; ++i) out[40+i] = static_cast<uint8_t>(h.sequence >> (56-8*i));
}
std::optional<Header> readHeader(const uint8_t* data, size_t size) {
    if (size < headerBytes || std::memcmp(data, "SST1", 4) || data[6] || data[7] || data[4] < 1 || data[4] > 11 || data[5] < 1 || data[5] > 2) return {};
    Header h {static_cast<Kind>(data[4]), static_cast<Role>(data[5]), {}, {}, 0};
    std::copy_n(data+8, 16, h.room.begin()); std::copy_n(data+24, 16, h.peer.begin());
    for (int i = 0; i < 8; ++i) h.sequence = (h.sequence << 8) | data[40+i];
    return h;
}
Control control(const Header& h) { Control out {}; writeHeader(out.data(), h); return out; }
WireAudio encrypt(const Header& h, const Key& key, const AudioPacket& audio) {
    WireAudio out {}; writeHeader(out.data(), h); randomBytes(out.data()+48, 24);
    std::array<uint8_t, 960> plain {};
    for (int i = 0; i < packetFrames; ++i) {
        const float values[] {audio[i].left, audio[i].right};
        for (int ch = 0; ch < 2; ++ch) {
            const uint32_t word = std::bit_cast<uint32_t>(std::isfinite(values[ch]) ? values[ch] : 0.0f);
            for (int b = 0; b < 4; ++b) plain[i*8+ch*4+b] = static_cast<uint8_t>(word >> (8*b));
        }
    }
    crypto_aead_lock(out.data()+88, out.data()+72, key.data(), out.data()+48, out.data(), 48, plain.data(), plain.size());
    return out;
}
bool decrypt(const uint8_t* wire, size_t size, const Key& key, AudioPacket& audio) {
    const auto h = readHeader(wire, size);
    if (size != audioBytes || !h || h->kind != Kind::audio || h->role != Role::send) return false;
    std::array<uint8_t, 960> plain {};
    if (crypto_aead_unlock(plain.data(), wire+72, key.data(), wire+48, wire, 48, wire+88, plain.size()) != 0) return false;
    for (int i = 0; i < packetFrames; ++i) {
        float values[2] {};
        for (int ch = 0; ch < 2; ++ch) {
            uint32_t word = 0;
            for (int b = 0; b < 4; ++b) word |= uint32_t(plain[i*8+ch*4+b]) << (8*b);
            float f = std::bit_cast<float>(word);
            values[ch] = std::isfinite(f) ? std::clamp(f, -8.0f, 8.0f) : 0.0f;
        }
        audio[i] = {values[0], values[1]};
    }
    return true;
}
Probe encryptProbe(const Header& header,const Key& key) {
    Probe wire {}; writeHeader(wire.data(),header);randomBytes(wire.data()+48,24);
    std::array<uint8_t,16> plain {};
    crypto_aead_lock(wire.data()+88,wire.data()+72,key.data(),wire.data()+48,wire.data(),48,plain.data(),plain.size());
    return wire;
}
bool authenticateProbe(const uint8_t* wire,size_t size,const Key& key) {
    auto h=readHeader(wire,size);
    if(size!=104 || !h || (h->kind!=Kind::directPing && h->kind!=Kind::directPong))return false;
    std::array<uint8_t,16> plain {};
    return crypto_aead_unlock(plain.data(),wire+72,key.data(),wire+48,wire,48,wire+88,plain.size())==0;
}
}
