#pragma once
#include "PluginProcessor.h"
#include "Updater.h"
#include <juce_gui_extra/juce_gui_extra.h>

class MonitorLookAndFeel final : public juce::LookAndFeel_V4 {
public:
    std::array<float,2> peaks {};
    void drawButtonBackground(juce::Graphics&,juce::Button&,const juce::Colour&,bool,bool) override;
    void drawButtonText(juce::Graphics&,juce::TextButton&,bool,bool) override;
    void drawLinearSlider(juce::Graphics&,int,int,int,int,float,float,float,juce::Slider::SliderStyle,juce::Slider&) override;
};
class ShareStreamEditor final : public juce::AudioProcessorEditor, private juce::Timer {
public:
    explicit ShareStreamEditor(ShareStreamProcessor&);
    ~ShareStreamEditor() override;
    void paint(juce::Graphics&) override;
    void resized() override;
    std::function<void()> onAudioSettings;
private:
    struct Content final : juce::Component {
        std::function<void(juce::Graphics&)> draw;
        void paint(juce::Graphics& g) override { if(draw)draw(g); }
    } content;
    void paintContent(juce::Graphics&);
    void timerCallback() override;
    void saveConfiguration();
    void updateMode();
    void copyInvite();
    void pasteInvite();
    void joinSession();
    void accountDialog();
    void roomDialog(int action);
    void selectRoom(const juce::var&);
    void rememberRoom();
    bool loadInvite(const juce::String&);
    ShareStreamProcessor& processor;
    MonitorLookAndFeel theme;
    juce::TooltipWindow tooltips {this,500};
    juce::Viewport viewport;
    juce::TextButton send {"Send audio"}, receive {"Listen"}, connect {"Leave session"};
    juce::TextButton create {"Create session"}, join {"Join session"}, newRoom {"New code"}, copy {"Copy invite"}, paste {"Paste invite"};
    juce::TextButton audioSettings {"Audio output..."}, settings {"Audio & connection settings"};
    juce::TextButton collaboration {"Voice & screen..."}, update {"Updates"};
    juce::SharedResourcePointer<sharestream::Updater> updater;
    juce::TextEditor server, port, room;
    juce::ComboBox buffer, quality;
    juce::ComboBox accountList, roomList;
    juce::TextButton accountLogin {"Add account"}, accountLogout {"Sign out"};
    juce::TextButton createSaved {"New room"}, saveSaved {"Save current"}, renameSaved {"Rename"}, inviteSaved {"Invite user"};
    juce::Label directoryStatus;
    juce::String directoryFingerprint;
    int directorySelection=0;
    juce::Slider monitor;
    std::unique_ptr<juce::AudioProcessorValueTreeState::SliderAttachment> monitorAttachment;
    juce::Label serverLabel, portLabel, roomLabel, bufferLabel, qualityLabel, status, stats, hint, gain, peak;
    sharestream::Statistics lastStats;
    std::vector<sharestream::Participant> people;
    juce::String notice, boundParameter;
    int noticeTicks=0;
    bool settingsOpen=false;
    int monitorY=0, settingsY=0;
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(ShareStreamEditor)
};
