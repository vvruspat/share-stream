#pragma once
#include "AudioRing.h"
#include <juce_audio_basics/juce_audio_basics.h>
#include <atomic>
#include <thread>
#include <mutex>
#include <memory>

namespace sharestream {
struct Connection {
    std::string host = defaultRelayHost;
    int port = defaultPort;
    std::string code;
    Role role = Role::send;
    int jitterMs = 40;
    bool preferDirect = true;
    AudioQuality quality = AudioQuality::float32;
};
struct Statistics {
    bool running = false, relay = false, peer = false, direct = false, waitingForAudio = false;
    double rttMs = 0, directRttMs = 0, jitterMs = 0;
    uint64_t packets = 0, lost = 0, underruns = 0, overruns = 0, rejected = 0, late = 0;
    float inputPeak = 0, outputPeak = 0;
    AudioQuality activeQuality = AudioQuality::float32;
    bool qualityNegotiated = false;
    std::string error;
};
class StreamEngine {
public:
    StreamEngine();
    ~StreamEngine();
    // Control thread only. Audio thread never takes the control mutex.
    bool connect(const Connection&);
    void disconnect();
    void prepare(double sampleRate, int maximumBlockSize);
    void process(float* const* audio, int numChannels, int numSamples) noexcept;
    Statistics statistics() const;
    bool isRunning() const noexcept;
    void setQuality(AudioQuality);
private:
    struct Session;
    void run(Session*);
    void setError(const std::string&);
    mutable std::mutex controlMutex, errorMutex;
    void disconnectLocked();
    std::unique_ptr<Session> current;
    std::atomic<Session*> active {nullptr};
    std::atomic<unsigned> audioReaders {0};
    std::string error;
    double hostRate = 48000;
    int maxBlock = 512;
};
}
