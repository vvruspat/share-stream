#pragma once
#include "PluginProcessor.h"
#include <juce_gui_extra/juce_gui_extra.h>

class ShareStreamEditor final : public juce::AudioProcessorEditor, private juce::Timer {
public:
    explicit ShareStreamEditor(ShareStreamProcessor&);
    ~ShareStreamEditor() override;
    void paint(juce::Graphics&) override;
    void resized() override;
    std::function<void()> onAudioSettings;
private:
    void timerCallback() override;
    void saveConfiguration();
    void updateMode();
    void copyInvite();
    void pasteInvite();
    ShareStreamProcessor& processor;
    juce::LookAndFeel_V4 theme;
    juce::TextButton send {"Send"}, receive {"Listen"}, connect {"Connect"};
    juce::TextButton newRoom {"New room"}, copy {"Copy invite"}, paste {"Paste invite"};
    juce::TextButton audioSettings {"Audio output..."};
    juce::TextEditor server, port, room;
    juce::ComboBox buffer;
    juce::Label serverLabel, roomLabel, bufferLabel, status, hint, stats;
    sharestream::Statistics lastStats;
    juce::String notice;
    int noticeTicks=0;
    float level=0;
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(ShareStreamEditor)
};
