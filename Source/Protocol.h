#pragma once
#include <array>
#include <cstdint>
#include <cstddef>
#include <string>
#include <optional>
#include <vector>

namespace sharestream {
constexpr int networkRate = 48000, packetFrames = 120, channels = 2;
constexpr int headerBytes = 48, controlBytes = 64, audioBytes = 1048;
constexpr int defaultPort = 48100;
enum class Role : uint8_t { send = 1, receive = 2 };
enum class Kind : uint8_t { hello = 1, cookie = 2, join = 3, ready = 4, audio = 5, ping = 6, pong = 7, leave = 8, endpoint = 9, directPing = 10, directPong = 11, encodedAudio = 12, capabilities = 13 };
enum class AudioQuality : uint8_t { float32 = 0, pcm24 = 1, opus320 = 2 };
constexpr uint8_t supportedQualities = 7;
constexpr bool validQuality(int value) { return value>=0 && value<=2; }
const char* qualityName(AudioQuality);
using Id = std::array<uint8_t, 16>;
using Key = std::array<uint8_t, 32>;
struct Room { Id id; Key key; };
struct Header { Kind kind; Role role; Id room; Id peer; uint64_t sequence; };
struct Stereo { float left = 0, right = 0; };
using AudioPacket = std::array<Stereo, packetFrames>;
using WireAudio = std::array<uint8_t, audioBytes>;
using Control = std::array<uint8_t, controlBytes>;
using Probe = std::array<uint8_t, 104>;
void randomBytes(void*, size_t);
std::string newRoomCode();
std::optional<Room> parseRoom(const std::string&);
void writeHeader(uint8_t*, const Header&);
std::optional<Header> readHeader(const uint8_t*, size_t);
Control control(const Header&);
WireAudio encrypt(const Header&, const Key&, const AudioPacket&);
bool decrypt(const uint8_t*, size_t, const Key&, AudioPacket&);
Probe encryptProbe(const Header&, const Key&);
bool authenticateProbe(const uint8_t*, size_t, const Key&);
struct EncodedFrame { AudioQuality quality; std::vector<uint8_t> bytes; };
std::vector<uint8_t> encryptFrame(const Header&, const Key&, const EncodedFrame&);
std::optional<EncodedFrame> decryptFrame(const uint8_t*, size_t, const Key&);
Probe encryptCapabilities(const Header&, const Key&, uint8_t formats = supportedQualities);
std::optional<uint8_t> decryptCapabilities(const uint8_t*, size_t, const Key&);
}
