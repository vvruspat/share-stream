#pragma once
#include <juce_core/juce_core.h>
#include <optional>

namespace sharestream::updates {
struct Release {
    juce::String version, name, url, sha256;
    juce::int64 size=0;
};
// Strict stable semver and an exact owner/repository/tag/asset URL. Never execute
// arbitrary links from release notes or accept a prerelease/downgrade.
bool newer(const juce::String& candidate,const juce::String& installed);
std::optional<Release> parseRelease(const juce::var&,const juce::String& installed,const juce::String& asset);
juce::String platformAsset();
juce::Result extractZip(juce::ZipFile&,const juce::File&);
juce::Result extractArchive(const juce::File&,const juce::File&);
}
