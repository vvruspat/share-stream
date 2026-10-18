#include "PluginEditor.h"

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
    for(auto* button:{&send,&receive,&connect,&newRoom,&copy,&paste}) { addAndMakeVisible(button); button->setMouseCursor(juce::MouseCursor::PointingHandCursor); }
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
    auto cfg=processor.configuration();
    server.setText(cfg.host,false); port.setText(juce::String(cfg.port),false); room.setText(cfg.code,false);
    room.setFont(juce::Font(juce::FontOptions(17).withName(juce::Font::getDefaultMonospacedFontName())));
    addAndMakeVisible(buffer);
    for(int ms:{5,10,20,40,80,100}) buffer.addItem(juce::String(ms)+" ms",ms);
    buffer.setSelectedId(cfg.jitterMs,juce::dontSendNotification);
    buffer.onChange=[this]{saveConfiguration();};
    for(auto* label:{&serverLabel,&roomLabel,&bufferLabel,&status,&hint,&stats}) {
        addAndMakeVisible(label); label->setColour(juce::Label::textColourId,muted);
        label->setFont(juce::Font(juce::FontOptions(14))); label->setBorderSize(juce::BorderSize<int>(0));
    }
    serverLabel.setText("RELAY SERVER / UDP PORT",juce::dontSendNotification);
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
    setSize(700,580); updateMode(); startTimerHz(15); timerCallback();
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
    juce::SystemClipboard::copyTextToClipboard("sharestream://"+juce::String(c.host)+":"+juce::String(c.port)+"/"+juce::String(c.code));
    notice="Invite copied. Send it to your partner.";noticeTicks=45;
}
void ShareStreamEditor::pasteInvite() {
    auto value=juce::SystemClipboard::getTextFromClipboard().trim();
    if(value.startsWith("sharestream://")) {
        auto rest=value.substring(14); auto authority=rest.upToFirstOccurrenceOf("/",false,false); auto code=rest.fromFirstOccurrenceOf("/",false,false);
        auto host=authority.upToLastOccurrenceOf(":",false,false); const int remotePort=authority.fromLastOccurrenceOf(":",false,false).getIntValue();
        if(!host.isEmpty() && remotePort>0 && remotePort<=65535 && sharestream::parseRoom(code.toStdString())) {
            server.setText(host);port.setText(juce::String(remotePort));room.setText(code);notice="Invite loaded. Press Connect.";noticeTicks=45;return;
        }
    } else if(sharestream::parseRoom(value.toStdString())) {room.setText(value);return;}
    notice="Clipboard must contain a Share Stream invite or room code.";noticeTicks=60;
}
void ShareStreamEditor::timerCallback() {
    lastStats=processor.statistics(); const bool running=lastStats.running;
    for(auto* field:{&server,&port,&room}) field->setReadOnly(running);
    for(auto* button:{&send,&receive,&newRoom,&paste}) button->setEnabled(!running);
    buffer.setEnabled(!running);
    connect.setButtonText(running ? "Disconnect" : "Connect");
    juce::String message;
    if(!lastStats.error.empty()) message=lastStats.error;
    else if(!running) message="Ready when you are";
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
    g.setColour(muted);g.setFont(juce::Font(juce::FontOptions(13)));g.drawText(processor.standalone()?"STANDALONE  /  0.1":"PLUGIN  /  0.1",490,65,176,25,juce::Justification::right);
    g.setColour(panel);g.fillRoundedRectangle(32,412,636,82,12);
    g.setColour(juce::Colour(0xff30443a));g.fillRoundedRectangle(48,474,604,4,2);
    g.setColour(green);g.fillRoundedRectangle(48,474,604*juce::jlimit(0.0f,1.0f,level),4,2);
    g.setColour(muted);g.setFont(juce::Font(juce::FontOptions(12)));
    g.drawText("48 kHz  /  STEREO FLOAT32  /  2.5 ms PACKETS  /  ENCRYPTED",32,546,636,20,juce::Justification::centred);
}
void ShareStreamEditor::resized() {
    send.setBounds(32,114,142,40);receive.setBounds(180,114,142,40);
    if(processor.standalone()) {receive.setBounds(32,114,142,40);audioSettings.setBounds(490,114,178,40);}
    hint.setBounds(32,165,636,24);
    serverLabel.setBounds(32,208,420,20);server.setBounds(32,234,470,46);port.setBounds(514,234,154,46);
    roomLabel.setBounds(32,296,420,20);newRoom.setBounds(546,289,122,30);room.setBounds(32,324,636,46);
    copy.setBounds(32,379,126,26);paste.setBounds(166,379,126,26);
    status.setBounds(48,424,604,25);stats.setBounds(48,451,604,18);
    bufferLabel.setBounds(32,507,148,18);buffer.setBounds(184,500,132,34);connect.setBounds(454,500,214,36);
}
