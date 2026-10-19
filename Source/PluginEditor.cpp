#include "PluginEditor.h"
#include "Invitation.h"

static const juce::Colour background(0xff101615), panel(0xff1a2421), green(0xffb2f5ca), text(0xffedf5f0), muted(0xff91a49a);
ShareStreamEditor::ShareStreamEditor(ShareStreamProcessor& p) : AudioProcessorEditor(p),processor(p) {
    theme.setColour(juce::TextButton::buttonColourId,panel);
    theme.setColour(juce::TextButton::buttonOnColourId,green);
    theme.setColour(juce::TextButton::textColourOffId,text);
    theme.setColour(juce::TextButton::textColourOnId,background);
    theme.setColour(juce::ComboBox::backgroundColourId,panel);
    theme.setColour(juce::ComboBox::textColourId,text);
    theme.setColour(juce::ComboBox::outlineColourId,juce::Colour(0xff34473d));
    theme.setColour(juce::PopupMenu::backgroundColourId,panel);
    theme.setColour(juce::PopupMenu::textColourId,text);
    setLookAndFeel(&theme);
    for(auto* button:{&send,&receive,&connect,&newRoom,&copy,&paste,&collaboration}) { addAndMakeVisible(button); button->setMouseCursor(juce::MouseCursor::PointingHandCursor); }
    collaboration.onClick=[this]{
        saveConfiguration(); const auto c=processor.configuration();
        const auto link=sharestream::invitationLink({c.code,sharestream::RelayAddress{c.host,c.port}});
        if(link.empty()) {notice="Enter a valid room, server and UDP port first.";noticeTicks=60;return;}
        if(!juce::URL(link).launchInDefaultBrowser()) {
            notice="Could not open browser. Visit stream.whitesquirrel.digital";noticeTicks=90;
        }
    };
    if(p.standalone()) {
        send.setVisible(false); addAndMakeVisible(audioSettings);
        audioSettings.onClick=[this]{if(onAudioSettings)onAudioSettings();};
    }
    for(auto* editor:{&server,&port,&room}) {
        addAndMakeVisible(editor); editor->setColour(juce::TextEditor::backgroundColourId,panel);
        editor->setColour(juce::TextEditor::textColourId,text); editor->setColour(juce::TextEditor::outlineColourId,juce::Colour(0xff34473d));
        editor->setColour(juce::TextEditor::focusedOutlineColourId,green);
        editor->setFont(juce::Font(juce::FontOptions(16))); editor->setIndents(12,13);
        editor->onTextChange=[this]{saveConfiguration();};
    }
    port.setInputRestrictions(5,"0123456789");
    port.setTooltip("Relay UDP port: 48100. This is not the audio sample rate.");
    auto cfg=processor.configuration();
    server.setText(cfg.host,false); port.setText(juce::String(cfg.port),false); room.setText(cfg.code,false);
    room.setFont(juce::Font(juce::FontOptions(17).withName(juce::Font::getDefaultMonospacedFontName())));
    addAndMakeVisible(buffer);
    for(int ms:{5,10,20,40,80,100}) buffer.addItem(juce::String(ms)+" ms",ms);
    buffer.setSelectedId(cfg.jitterMs,juce::dontSendNotification);
    buffer.onChange=[this]{saveConfiguration();};
    for(auto* label:{&serverLabel,&portLabel,&roomLabel,&bufferLabel,&status,&hint,&stats}) {
        addAndMakeVisible(label); label->setColour(juce::Label::textColourId,muted);
        label->setFont(juce::Font(juce::FontOptions(14))); label->setBorderSize(juce::BorderSize<int>(0));
    }
    serverLabel.setText("RELAY SERVER",juce::dontSendNotification);
    portLabel.setText("UDP PORT",juce::dontSendNotification);
    roomLabel.setText("PRIVATE ROOM CODE",juce::dontSendNotification);
    bufferLabel.setText("MIN. NET BUFFER",juce::dontSendNotification);
    status.setFont(juce::Font(juce::FontOptions(18).withStyle("Bold")));
    send.onClick=[this]{auto c=processor.configuration();c.role=sharestream::Role::send;processor.setConfiguration(c);updateMode();};
    receive.onClick=[this]{auto c=processor.configuration();c.role=sharestream::Role::receive;processor.setConfiguration(c);updateMode();};
    newRoom.onClick=[this]{room.setText(sharestream::newRoomCode());};
    copy.onClick=[this]{copyInvite();}; paste.onClick=[this]{pasteInvite();};
    connect.onClick=[this]{ if(processor.statistics().running) processor.stop(); else {saveConfiguration();processor.start();} timerCallback(); };
    connect.setColour(juce::TextButton::buttonColourId,green);
    connect.setColour(juce::TextButton::textColourOffId,background);
    addAndMakeVisible(update);
    update.onClick=[this]{
        const auto state=updater->state();
        juce::PopupMenu menu;
        if(state.available)menu.addItem(1,"Download and install update");
        menu.addItem(2,"Check now",!state.busy);
        menu.addItem(3,"Check automatically (daily)",true,state.automatic);
        menu.showMenuAsync(juce::PopupMenu::Options().withTargetComponent(update),[safe=juce::Component::SafePointer<ShareStreamEditor>(this)](int choice){
            if(!safe)return;
            if(choice==1) {
                juce::AlertWindow::showAsync(juce::MessageBoxOptions().withIconType(juce::MessageBoxIconType::InfoIcon)
                    .withTitle("Install Share Stream update")
                    .withMessage("The installer updates the standalone and plug-ins together. Save your session first. Restart your DAW after installation. On Windows, close the DAW and standalone before the installer replaces files.")
                    .withButton("Download and install").withButton("Later"),[safe](int result){if(safe && result==1)safe->updater->check(true);});
            } else if(choice==2)safe->updater->check();
            else if(choice==3)safe->updater->setAutomatic(!safe->updater->state().automatic);
        });
    };
    setSize(700,624); updateMode(); startTimerHz(15); timerCallback();
}
ShareStreamEditor::~ShareStreamEditor() { stopTimer(); setLookAndFeel(nullptr); }
void ShareStreamEditor::saveConfiguration() {
    auto c=processor.configuration(); c.host=server.getText().trim().toStdString();
    c.port=port.getText().getIntValue(); c.code=room.getText().trim().toStdString(); c.jitterMs=buffer.getSelectedId();
    processor.setConfiguration(c);
}
void ShareStreamEditor::updateMode() {
    bool listening=processor.configuration().role==sharestream::Role::receive;
    send.setToggleState(!listening,juce::dontSendNotification); receive.setToggleState(listening,juce::dontSendNotification);
    hint.setText(listening ? "Listen to your partner. Local input stays out of the stream." : "Send this track in stereo. Local audio passes through unchanged.",juce::dontSendNotification);
    repaint();
}
void ShareStreamEditor::copyInvite() {
    saveConfiguration(); auto c=processor.configuration();
    if(!sharestream::parseRoom(c.code)) {notice="Enter a valid room code first.";noticeTicks=45;return;}
    const auto link=sharestream::invitationLink({c.code,sharestream::RelayAddress{c.host,c.port}});
    if(link.empty()) {notice="Enter a valid server and UDP port first.";noticeTicks=45;return;}
    juce::SystemClipboard::copyTextToClipboard(link);
    notice="Invite copied. One invite for music, voice and screen.";noticeTicks=60;
}
void ShareStreamEditor::pasteInvite() {
    const auto invite=sharestream::parseInvitation(juce::SystemClipboard::getTextFromClipboard().toStdString());
    if(invite) {
        if(invite->relay) {server.setText(invite->relay->host);port.setText(juce::String(invite->relay->port));}
        room.setText(invite->code);notice="Invite loaded. Music, voice and screen use this room.";noticeTicks=60;return;
    }
    notice="Clipboard must contain a Share Stream invite or room code.";noticeTicks=60;
}
void ShareStreamEditor::timerCallback() {
    const auto updateState=updater->state();
    update.setButtonText(updateState.text);update.setEnabled(!updateState.busy);
    if(updateState.ready && updater->launch()) {
#if JUCE_MAC || JUCE_WINDOWS
        if(processor.standalone() && juce::JUCEApplication::getInstance()!=nullptr)juce::JUCEApplication::quit();
#endif
    }
    lastStats=processor.statistics(); const bool running=lastStats.running;
    for(auto* field:{&server,&port,&room}) field->setReadOnly(running);
    for(auto* button:{&send,&receive,&newRoom,&paste}) button->setEnabled(!running);
    buffer.setEnabled(!running);
    connect.setButtonText(running ? "Disconnect" : "Connect");
    juce::String message;
    if(!lastStats.error.empty()) message=lastStats.error;
    else if(!running) message="Ready when you are";
    else if(lastStats.waitingForAudio) message="Waiting for DAW audio. Enable monitoring or playback.";
    else if(!lastStats.relay && !lastStats.direct) message="Connecting to relay...";
    else if(!lastStats.peer) message="Room open. Waiting for your partner...";
    else message=(lastStats.direct ? "Direct P2P / " : "Relay / ")+juce::String(processor.configuration().role==sharestream::Role::send ? "sending audio" : (lastStats.packets ? "receiving audio" : "waiting for audio"));
    status.setText(message,juce::dontSendNotification);
    status.setColour(juce::Label::textColourId,!lastStats.error.empty()?juce::Colour(0xffffb19a):green);
    stats.setText((lastStats.direct ? "Peer RTT " : "Relay RTT ")+juce::String(lastStats.direct ? lastStats.directRttMs : lastStats.rttMs,1)+" ms   Buffer "+juce::String(lastStats.jitterMs,0)+" ms   Packets "+juce::String(lastStats.packets)+"   Lost "+juce::String(lastStats.lost)+"   Dropouts "+juce::String(lastStats.underruns),juce::dontSendNotification);
    if(noticeTicks>0) {--noticeTicks;hint.setText(notice,juce::dontSendNotification);} else updateMode();
    const float target=processor.configuration().role==sharestream::Role::send ? lastStats.inputPeak : lastStats.outputPeak;
    level=std::max(target,level*0.82f); repaint();
}
void ShareStreamEditor::paint(juce::Graphics& g) {
    g.fillAll(background);
    g.setColour(green);g.setFont(juce::Font(juce::FontOptions(12).withStyle("Bold")));g.drawText("AUDIO, ACROSS THE DISTANCE",32,24,520,20,juce::Justification::left);
    g.setColour(text);g.setFont(juce::Font(juce::FontOptions(38).withStyle("Bold")));g.drawText("Share Stream",30,47,480,48,juce::Justification::left);
    g.setColour(muted);g.setFont(juce::Font(juce::FontOptions(13)));g.drawText(juce::String(processor.standalone()?"STANDALONE  /  ":"PLUGIN  /  ")+SHARE_STREAM_VERSION,490,65,176,25,juce::Justification::right);
    g.setColour(panel);g.fillRoundedRectangle(32,412,636,82,12);
    g.setColour(juce::Colour(0xff30443a));g.fillRoundedRectangle(48,474,604,4,2);
    g.setColour(green);g.fillRoundedRectangle(48,474,604*juce::jlimit(0.0f,1.0f,level),4,2);
    g.setColour(muted);g.setFont(juce::Font(juce::FontOptions(12)));
    g.drawText("48 kHz  /  STEREO FLOAT32  /  2.5 ms PACKETS  /  ENCRYPTED",32,546,636,20,juce::Justification::centred);
}
void ShareStreamEditor::resized() {
    send.setBounds(32,114,142,40);receive.setBounds(180,114,142,40);
    collaboration.setBounds(processor.standalone()?210:440,114,228,40);
    if(processor.standalone()) {receive.setBounds(32,114,142,40);audioSettings.setBounds(490,114,178,40);}
    hint.setBounds(32,165,636,24);
    serverLabel.setBounds(32,208,420,20);portLabel.setBounds(514,208,154,20);server.setBounds(32,234,470,46);port.setBounds(514,234,154,46);
    roomLabel.setBounds(32,296,420,20);newRoom.setBounds(546,289,122,30);room.setBounds(32,324,636,46);
    copy.setBounds(32,379,126,26);paste.setBounds(166,379,126,26);
    status.setBounds(48,424,604,25);stats.setBounds(48,451,604,18);
    bufferLabel.setBounds(32,507,148,18);buffer.setBounds(184,500,132,34);connect.setBounds(454,500,214,36);
    update.setBounds(32,581,636,28);
}
