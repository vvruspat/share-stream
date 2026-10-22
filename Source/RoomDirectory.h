#pragma once
#include <juce_core/juce_core.h>
#include <deque>
#include <mutex>

namespace sharestream {
class RoomDirectory final : private juce::Thread {
public:
    struct State {
        juce::var accounts, rooms, user, selected;
        juce::String error, notice;
        juce::String browserTicket, browserCode, browserAccount;
        double browserExpiresAt=0;
        int browserSequence=0;
        bool busy=false;
        int selection=0;
    };
    RoomDirectory();
    ~RoomDirectory() override;
    State state() const;
    juce::String participant(const juce::String& code) const;
    juce::String name() const;
    void request(juce::String path, juce::var body=juce::var(), juce::String method="POST");
    void select(int accountIndex);
    bool requestBrowserHandoff(const juce::String& code, const juce::String& host, int port);
    void cancelBrowserHandoff();
private:
    struct Task { juce::String path, method; juce::var body; int accountIndex=-1; uint64_t browserGeneration=0; };
    void run() override;
    juce::var perform(const Task&, const juce::String& token);
    void save();
    mutable std::mutex mutex;
    State current;
    juce::var accounts {juce::Array<juce::var>()};
    juce::String active, token, removedAccount;
    std::deque<Task> tasks;
    uint64_t browserGeneration=0;
};
}
