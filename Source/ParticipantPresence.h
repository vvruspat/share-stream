#pragma once
#include <juce_cryptography/juce_cryptography.h>
#include <functional>
#include <mutex>

namespace sharestream {
struct Participant {
    juce::String id, name, music;
    bool browser=false, mic=false, speaking=false;
};
class ParticipantPresence final : private juce::Thread {
public:
    struct State { std::vector<Participant> participants; bool available=false; juce::String room; };
    using ReadSession = std::function<juce::var()>;
    explicit ParticipantPresence(ReadSession);
    ~ParticipantPresence() override;
    void activate();
    State state() const;
    static juce::String identity(const juce::String& token);
    static juce::String localToken(const juce::String& room);
private:
    void run() override;
    ReadSession readSession;
    mutable std::mutex mutex;
    State current;
};
}
