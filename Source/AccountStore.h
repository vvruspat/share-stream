#pragma once
#include <juce_core/juce_core.h>
#include <functional>

namespace sharestream {
// All processes write through this implementation (the desktop uses the small
// session helper), so login/logout cannot race a stale plug-in account snapshot.
class AccountStore {
public:
    static bool enabled();
    static juce::File file();
    static juce::var read();
    static juce::var update(const std::function<void(juce::DynamicObject&)>&);
    static juce::var put(const juce::var& user, const juce::String& token);
    static juce::var remove(const juce::String& id);
    static juce::var select(const juce::String& id);
    static juce::var openRoom(const juce::var& room, bool launch=false);
    static juce::var summary(const juce::var&);
};
}
