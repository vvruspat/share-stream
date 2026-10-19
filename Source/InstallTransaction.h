#pragma once
#include <juce_core/juce_core.h>
namespace sharestream::updates {
struct InstallItem {juce::File source,destination;};
// Stages and validates every item first; rename each destination on its own
// volume, roll back the entire set if any replacement fails. Preserve backups.
juce::Result install(const std::vector<InstallItem>&,const juce::File& backup,
                     const std::function<juce::Result(const juce::File&)>& validate);
}
