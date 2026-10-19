#pragma once
#include "UpdateContract.h"
#include <juce_cryptography/juce_cryptography.h>

namespace sharestream {
class Updater final : private juce::Thread {
public:
    struct State {
        juce::String text="Check for updates";
        bool busy=false, available=false, ready=false, automatic=true;
    };
    explicit Updater(juce::String runningVersion=SHARE_STREAM_VERSION,bool checkOnStartup=true);
    ~Updater() override;
    State state();
    void check(bool download=false);
    void setAutomatic(bool);
    // Called on the message thread, once, after verified download preparation.
    bool launch(bool reopenReceiver=false);
private:
    void run() override;
    void setText(const juce::String&);
    juce::File settingsFile() const;
    const juce::String installedVersion;
    juce::CriticalSection mutex;
    State current;
    std::optional<updates::Release> release;
    bool downloading=false;
    juce::int64 nextCheck=0;
    juce::File installer;
    std::unique_ptr<juce::ChildProcess> packageManager;
    juce::InterProcessLock updateLock {"audio.sharestream.update"};
};
}
