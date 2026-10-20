#include "PluginEditor.h"
#include "Invitation.h"

static const juce::Colour background(0xff101615), panel(0xff1a2421), green(0xffb2f5ca), text(0xffedf5f0), muted(0xff91a49a), border(0xff304139);
static void labelStyle(juce::Label& l,float size=14) {l.setColour(juce::Label::textColourId,muted);l.setFont(juce::Font(juce::FontOptions(size)));l.setBorderSize(juce::BorderSize<int>(0));}
void MonitorLookAndFeel::drawButtonBackground(juce::Graphics& g,juce::Button& b,const juce::Colour& colour,bool over,bool down) {
    if(b.getComponentID()=="disclosure" || b.getComponentID()=="footer")return;
    juce::LookAndFeel_V4::drawButtonBackground(g,b,colour,over,down);
}
void MonitorLookAndFeel::drawButtonText(juce::Graphics& g,juce::TextButton& b,bool over,bool down) {
    if(b.getComponentID()!="disclosure" && b.getComponentID()!="footer") {juce::LookAndFeel_V4::drawButtonText(g,b,over,down);return;}
    g.setColour(over?green:muted);g.setFont(juce::Font(juce::FontOptions(14)));
    if(b.getComponentID()=="disclosure") {
        juce::Path arrow;
        if(b.getToggleState())arrow.addTriangle(0,16,10,16,5,23);else arrow.addTriangle(1,14,1,25,8,19.5f);
        g.fillPath(arrow);g.drawText(b.getButtonText(),22,0,b.getWidth()-22,b.getHeight(),juce::Justification::left);
    } else g.drawText(b.getButtonText(),0,0,b.getWidth(),b.getHeight(),juce::Justification::right);
    if(b.hasKeyboardFocus(true)){g.setColour(green);g.drawRoundedRectangle(b.getLocalBounds().toFloat().reduced(1),4,1);}
}
void MonitorLookAndFeel::drawLinearSlider(juce::Graphics& g,int x,int y,int width,int height,float position,float,float,juce::Slider::SliderStyle,juce::Slider& slider) {
    const float top=y+height*0.5f-5;
    for(int ch=0;ch<2;++ch) {
        const float row=top+ch*7;
        g.setColour(border);g.fillRoundedRectangle(static_cast<float>(x),row,static_cast<float>(width),5,2);
        // Signal is in dBFS (-60..0); the thumb uses its independent -60..+6 dB gain scale.
        const float db=juce::Decibels::gainToDecibels(peaks[ch],-60.0f);
        const float fraction=juce::jlimit(0.0f,1.0f,(db+60)/60);
        if(fraction>0) {g.setColour(peaks[ch]>1?juce::Colour(0xffffb19a):green);g.fillRoundedRectangle(static_cast<float>(x),row,width*fraction,5,2);}
    }
    g.setColour(background);g.fillRoundedRectangle(position-5,top-7,10,26,4);
    g.setColour(green);g.drawRoundedRectangle(position-5,top-7,10,26,4,1.5f);
    g.fillRoundedRectangle(position-2,top-4,4,20,2);
    if(slider.hasKeyboardFocus(true)){g.setColour(text);g.drawRoundedRectangle(position-8,top-10,16,32,5,1);}
}
ShareStreamEditor::ShareStreamEditor(ShareStreamProcessor& p) : AudioProcessorEditor(p),processor(p) {
    theme.setColour(juce::TextButton::buttonColourId,panel);theme.setColour(juce::TextButton::buttonOnColourId,juce::Colour(0xff304139));
    theme.setColour(juce::TextButton::textColourOffId,text);theme.setColour(juce::TextButton::textColourOnId,text);
    theme.setColour(juce::ComboBox::backgroundColourId,panel);theme.setColour(juce::ComboBox::textColourId,text);theme.setColour(juce::ComboBox::outlineColourId,border);
    theme.setColour(juce::PopupMenu::backgroundColourId,panel);theme.setColour(juce::PopupMenu::textColourId,text);
    setLookAndFeel(&theme);
    addAndMakeVisible(viewport);viewport.setViewedComponent(&content,false);viewport.setScrollBarsShown(true,false);
    content.draw=[this](juce::Graphics& g){paintContent(g);};
    for(auto* button:{&send,&receive,&connect,&create,&join,&newRoom,&copy,&paste,&settings,&audioSettings}) {
        content.addAndMakeVisible(button);button->setMouseCursor(juce::MouseCursor::PointingHandCursor);
    }
    for(auto* button:{&collaboration,&update}) {addAndMakeVisible(button);button->setMouseCursor(juce::MouseCursor::PointingHandCursor);}
    collaboration.onClick=[this]{
        saveConfiguration();const auto link=processor.collaborationLink();
        if(link.isEmpty()){notice="Enter a valid session and server in settings.";noticeTicks=60;return;}
        if(!juce::URL(link).launchInDefaultBrowser()){notice="Could not open the browser.";noticeTicks=60;}
    };
    collaboration.setTooltip("Open voice and screen in this session. Microphone and screen stay off until you enable them.");
    audioSettings.onClick=[this]{if(onAudioSettings)onAudioSettings();};
    for(auto* editor:{&server,&port,&room}) {
        content.addAndMakeVisible(editor);editor->setColour(juce::TextEditor::backgroundColourId,panel);editor->setColour(juce::TextEditor::textColourId,text);
        editor->setColour(juce::TextEditor::outlineColourId,border);editor->setColour(juce::TextEditor::focusedOutlineColourId,green);
        editor->setFont(juce::Font(juce::FontOptions(14)));editor->setIndents(10,11);editor->onTextChange=[this]{saveConfiguration();};
    }
    server.setTitle("Relay server");port.setTitle("UDP port");room.setTitle("Private session code");
    port.setInputRestrictions(5,"0123456789");
    auto cfg=processor.configuration();server.setText(cfg.host,false);port.setText(juce::String(cfg.port),false);room.setText(cfg.code,false);
    content.addAndMakeVisible(buffer);for(int ms:{5,10,20,40,80,100})buffer.addItem(juce::String(ms)+" ms",ms);
    buffer.setSelectedId(cfg.jitterMs,juce::dontSendNotification);buffer.onChange=[this]{saveConfiguration();};
    content.addAndMakeVisible(quality);for(int value=0;value<3;++value)quality.addItem(sharestream::qualityName(static_cast<sharestream::AudioQuality>(value)),value+1);
    quality.setSelectedId(static_cast<int>(cfg.quality)+1,juce::dontSendNotification);quality.onChange=[this]{saveConfiguration();};
    quality.setTooltip("Sender controls the stream format. Older peers use Float32 automatically. PCM 24-bit and Opus clip above 0 dBFS.");
    content.addAndMakeVisible(monitor);monitor.setSliderStyle(juce::Slider::LinearHorizontal);monitor.setTextBoxStyle(juce::Slider::NoTextBox,false,0,0);
    monitor.setDoubleClickReturnValue(true,0);monitor.setTitle("Local monitor");monitor.setTooltip("Only changes your local output. Double-click for 0 dB. Gain -60 to +6 dB; L/R bars show the output signal in dBFS.");
    monitor.onValueChange=[this]{gain.setText(monitor.getValue()<=-60?"Mute":juce::String(monitor.getValue(),1)+" dB",juce::dontSendNotification);};
    for(auto* l:{&serverLabel,&portLabel,&roomLabel,&bufferLabel,&qualityLabel,&status,&stats,&hint,&gain,&peak}){content.addAndMakeVisible(l);labelStyle(*l);}
    labelStyle(status,15);status.setColour(juce::Label::textColourId,green);labelStyle(hint,12);labelStyle(stats,11);labelStyle(peak,12);
    gain.setJustificationType(juce::Justification::right);peak.setJustificationType(juce::Justification::right);
    serverLabel.setText("RELAY SERVER",juce::dontSendNotification);portLabel.setText("UDP PORT",juce::dontSendNotification);roomLabel.setText("SESSION CODE",juce::dontSendNotification);
    bufferLabel.setText("Network buffer",juce::dontSendNotification);qualityLabel.setText("Stream quality",juce::dontSendNotification);
    send.onClick=[this]{auto c=processor.configuration();c.role=sharestream::Role::send;processor.setConfiguration(c);updateMode();timerCallback();};
    receive.onClick=[this]{auto c=processor.configuration();c.role=sharestream::Role::receive;processor.setConfiguration(c);updateMode();timerCallback();};
    send.setTooltip("Send music from this track. Your partner selects Listen.");receive.setTooltip("Receive your partner's music into this track.");
    create.onClick=[this]{saveConfiguration();processor.start();timerCallback();};
    join.onClick=[this]{joinSession();};copy.onClick=[this]{copyInvite();};paste.onClick=[this]{pasteInvite();};
    newRoom.onClick=[this]{room.setText(sharestream::newRoomCode());};
    connect.onClick=[this]{processor.stop();timerCallback();};
    settings.onClick=[this]{settingsOpen=!settingsOpen;settings.setToggleState(settingsOpen,juce::dontSendNotification);resized();repaint();};settings.setTitle("Audio and connection settings");settings.setComponentID("disclosure");
    collaboration.setComponentID("footer");update.setComponentID("footer");
    for(auto* b:{&create,&copy}){b->setColour(juce::TextButton::buttonColourId,green);b->setColour(juce::TextButton::textColourOffId,background);}
    update.onClick=[this]{
        const auto state=updater->state();juce::PopupMenu menu;
        if(state.available)menu.addItem(1,"Download and install update");menu.addItem(2,"Check now",!state.busy);menu.addItem(3,"Check automatically (daily)",true,state.automatic);
        menu.showMenuAsync(juce::PopupMenu::Options().withTargetComponent(update),[safe=juce::Component::SafePointer<ShareStreamEditor>(this)](int choice){
            if(!safe)return;
            if(choice==1)juce::AlertWindow::showAsync(juce::MessageBoxOptions().withIconType(juce::MessageBoxIconType::InfoIcon).withTitle("Install Share Stream update")
                .withMessage("The installer updates the standalone and plug-ins together. Save your session first. Restart your DAW after installation. On Windows, close the DAW and standalone before installation.")
                .withButton("Download and install").withButton("Later"),[safe](int result){if(safe && result==1)safe->updater->check(true);});
            else if(choice==2)safe->updater->check();else if(choice==3)safe->updater->setAutomatic(!safe->updater->state().automatic);
        });
    };
    setSize(640,780);updateMode();startTimerHz(20);timerCallback();
}
ShareStreamEditor::~ShareStreamEditor(){stopTimer();viewport.setViewedComponent(nullptr,false);setLookAndFeel(nullptr);}
void ShareStreamEditor::saveConfiguration(){
    auto c=processor.configuration();c.host=sharestream::canonicalRelayHost(server.getText().trim().toStdString());c.port=port.getText().getIntValue();c.code=room.getText().trim().toStdString();c.jitterMs=buffer.getSelectedId();
    if(server.getText().toStdString()!=c.host)server.setText(c.host,false);
    if(c.role==sharestream::Role::send && quality.getSelectedId()>0)c.quality=static_cast<sharestream::AudioQuality>(quality.getSelectedId()-1);processor.setConfiguration(c);
}
void ShareStreamEditor::updateMode(){
    const bool listening=processor.configuration().role==sharestream::Role::receive;
    send.setToggleState(!listening,juce::dontSendNotification);receive.setToggleState(listening,juce::dontSendNotification);send.setVisible(!processor.standalone());
    const juce::String parameter=listening?"listenMonitorDb":"sendMonitorDb";
    if(boundParameter!=parameter){monitorAttachment.reset();boundParameter=parameter;monitorAttachment=std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment>(processor.parameters,parameter,monitor);}
    quality.setEnabled(!listening);quality.setSelectedId(static_cast<int>(listening?lastStats.activeQuality:processor.configuration().quality)+1,juce::dontSendNotification);
}
void ShareStreamEditor::copyInvite(){
    saveConfiguration();const auto c=processor.configuration();const auto link=sharestream::invitationLink({c.code,sharestream::RelayAddress{c.host,c.port}});
    if(link.empty()){notice="Enter a valid session and server in settings.";noticeTicks=60;return;}
    juce::SystemClipboard::copyTextToClipboard(link);
    if(!processor.statistics().running)processor.start();notice="Invite copied. Voice and screen use this session too.";noticeTicks=60;timerCallback();
}
bool ShareStreamEditor::loadInvite(const juce::String& value){
    const auto invite=sharestream::parseInvitation(value.toStdString());if(!invite)return false;
    processor.stop();if(invite->relay){server.setText(invite->relay->host,false);port.setText(juce::String(invite->relay->port),false);}
    room.setText(invite->code,false);saveConfiguration();processor.start();notice="Joining the session...";noticeTicks=40;timerCallback();return true;
}
void ShareStreamEditor::pasteInvite(){if(!loadInvite(juce::SystemClipboard::getTextFromClipboard())){notice="Copy a Share Stream invite or session code first.";noticeTicks=60;}}
void ShareStreamEditor::joinSession(){
    const auto clipboard=juce::SystemClipboard::getTextFromClipboard();if(loadInvite(clipboard))return;
    auto* dialog=new juce::AlertWindow("Join session","Paste the invitation from your partner.",juce::MessageBoxIconType::NoIcon);
    dialog->addTextEditor("invite",{},"Invite or session code");dialog->addButton("Join",1,juce::KeyPress(juce::KeyPress::returnKey));dialog->addButton("Cancel",0,juce::KeyPress(juce::KeyPress::escapeKey));
    dialog->enterModalState(true,juce::ModalCallbackFunction::create([safe=juce::Component::SafePointer<ShareStreamEditor>(this),dialog](int result){
        if(safe && result==1 && !safe->loadInvite(dialog->getTextEditorContents("invite"))){safe->notice="That invitation is not valid. Try Join session again.";safe->noticeTicks=80;}
    }),true);
}
void ShareStreamEditor::timerCallback(){
    const auto u=updater->state();update.setButtonText(u.available?"Update available":"Updates");update.setTooltip(u.text);update.setEnabled(!u.busy);
    if(u.ready && updater->launch(processor.standalone())){
#if JUCE_MAC || JUCE_WINDOWS
        if(processor.standalone() && juce::JUCEApplication::getInstance())juce::JUCEApplication::quit();
#endif
    }
    lastStats=processor.statistics();const bool running=lastStats.running;
    for(auto* f:{&server,&port,&room})f->setReadOnly(running);newRoom.setEnabled(!running);buffer.setEnabled(!running);
    create.setVisible(!running);join.setVisible(!running);copy.setVisible(running);connect.setVisible(running);
    updateMode();
    juce::String message;
    if(!lastStats.error.empty())message=lastStats.error;
    else if(!running)message="Create a session or join your partner.";
    else if(lastStats.waitingForAudio)message="Waiting for DAW audio - enable playback or monitoring.";
    else if(!lastStats.relay && !lastStats.direct)message="Connecting...";
    else if(!lastStats.peer)message="Session open / waiting for your partner";
    else message=processor.configuration().role==sharestream::Role::send?"Connected / sending music":"Connected / listening to music";
    status.setText(message,juce::dontSendNotification);status.setColour(juce::Label::textColourId,!lastStats.error.empty()?juce::Colour(0xffffb19a):muted);
    const auto rtt=lastStats.direct?lastStats.directRttMs:lastStats.rttMs;
    stats.setText((lastStats.direct?"Peer RTT ":"Relay RTT ")+(rtt>0?juce::String(rtt,1)+" ms":"-")+"   Buffer "+juce::String(lastStats.jitterMs,0)+" ms   Packets "+juce::String(lastStats.packets)+"   Lost "+juce::String(lastStats.lost)+"   Dropouts "+juce::String(lastStats.underruns),juce::dontSendNotification);
    if(noticeTicks>0){--noticeTicks;hint.setText(notice,juce::dontSendNotification);}else hint.setText("Only changes what you hear. L/R show local output in dBFS.",juce::dontSendNotification);
    theme.peaks=processor.monitorPeaks();
    const auto max=std::max(theme.peaks[0],theme.peaks[1]);peak.setText(max>0?"Peak "+juce::String(juce::Decibels::gainToDecibels(max,-100.0f),1)+" dBFS":"Peak -inf dBFS",juce::dontSendNotification);
    gain.setText(monitor.getValue()<=-60?"Mute":juce::String(monitor.getValue(),1)+" dB",juce::dontSendNotification);
    auto roster=processor.participants();auto next=roster.participants;const auto id=processor.participantId();
    if(std::none_of(next.begin(),next.end(),[&](const auto& p){return p.id==id;}))next.insert(next.begin(),{id,"You",running?(lastStats.peer?(processor.configuration().role==sharestream::Role::send?"sending":"listening"):"connecting"):"",false,false,false});
    // Older servers have no identity bridge. Report the real music peer without
    // claiming it belongs to any unlinked browser participant.
    if(!roster.available && lastStats.peer)next.push_back({{},"Music partner",processor.configuration().role==sharestream::Role::send?"listening":"sending",false,false,false});
    const bool resize=people.size()!=next.size();people=std::move(next);if(resize)resized();monitor.repaint();content.repaint();repaint();
}
void ShareStreamEditor::paint(juce::Graphics& g){
    g.fillAll(background);g.setColour(text);g.setFont(juce::Font(juce::FontOptions(25).withStyle("Bold")));g.drawText("Share Stream",28,20,180,40,juce::Justification::left);
    g.setColour(muted);g.setFont(juce::Font(juce::FontOptions(23)));g.drawText("/ Music",211,20,145,40,juce::Justification::left);
    const bool connected=lastStats.running && !lastStats.waitingForAudio && (lastStats.relay || lastStats.direct);
    const juce::String state=!lastStats.error.empty()?"Error":!lastStats.running?"Not connected":connected?"Connected":"Connecting...";
    g.setFont(juce::Font(juce::FontOptions(13)));g.drawText(state,420,25,192,30,juce::Justification::right);g.setColour(connected?green:muted);g.fillEllipse(598-state.length()*6.0f,37,6,6);
    g.setColour(border);g.drawHorizontalLine(80,0,640);g.drawHorizontalLine(getHeight()-56,0,640);
    g.setColour(muted);g.setFont(juce::Font(juce::FontOptions(12)));const auto rate=processor.currentSampleRate();
    g.drawText(rate>0?juce::String(rate/1000,1)+" kHz / Stereo":"Stereo / Audio engine idle",28,getHeight()-45,220,28,juce::Justification::left);
}
void ShareStreamEditor::paintContent(juce::Graphics& g){
    g.fillAll(background);g.setColour(panel);g.fillRoundedRectangle(28,16,584,48,12);g.drawRoundedRectangle(28,16,584,48,12,1);
    g.setColour(panel);g.fillRoundedRectangle(28,86,584,154,12);g.setColour(border);g.drawRoundedRectangle(28,86,584,154,12,1);
    g.setColour(muted);g.setFont(juce::Font(juce::FontOptions(11)));g.drawText("PRIVATE SESSION",48,102,520,22,juce::Justification::left);
    g.setColour(text);g.setFont(juce::Font(juce::FontOptions(25).withStyle("Bold")));g.drawText(lastStats.running?"Music session":"Make room for the mix.",48,127,530,34,juce::Justification::left);
    g.setColour(border);g.drawHorizontalLine(262,28,612);
    g.setColour(text);g.setFont(juce::Font(juce::FontOptions(15)));g.drawText("Participants / "+juce::String(people.size()),28,276,300,24,juce::Justification::left);
    int y=316;const auto self=processor.participantId();
    for(const auto& p:people){
        g.setColour(juce::Colour(0xff2d3a33));g.fillEllipse(28,static_cast<float>(y),36,36);g.setColour(text);g.setFont(juce::Font(juce::FontOptions(15)));
        g.drawText(p.name.substring(0,1).toUpperCase(),28,y,36,36,juce::Justification::centred);
        g.drawText(p.name+(p.id==self && p.name!="You"?" (you)":""),78,y-2,350,24,juce::Justification::left,true);
        g.setColour(muted);g.setFont(juce::Font(juce::FontOptions(12)));
        const auto music=p.music=="sending"?"Sending music":p.music=="listening"?"Listening to music":p.music=="connecting"?"Connecting music...":p.browser?"Voice only / Plugin not connected":"Not connected";
        g.drawText(music,78,y+21,350,20,juce::Justification::left,true);
        g.setColour(p.speaking?green:muted);g.drawText(!p.browser?"Voice not joined":p.speaking?"Speaking":p.mic?"Mic on":"Mic off",440,y+7,170,24,juce::Justification::right,true);y+=58;
    }
    g.setColour(border);g.drawHorizontalLine(monitorY-14,28,612);g.drawHorizontalLine(settingsY-8,28,612);
    g.setColour(muted);g.setFont(juce::Font(juce::FontOptions(15)));g.drawText("Local monitor",28,monitorY,340,26,juce::Justification::left);
    g.setFont(juce::Font(juce::FontOptions(8)));g.drawText("L",28,monitorY+39,12,7,juce::Justification::left);g.drawText("R",28,monitorY+46,12,7,juce::Justification::left);
    g.setFont(juce::Font(juce::FontOptions(12)));g.drawText("Local output / Stereo",28,monitorY+73,300,20,juce::Justification::left);
    if(settingsOpen){
        g.setFont(juce::Font(juce::FontOptions(11)));g.drawText("Music is encrypted / "+juce::String(sharestream::qualityName(lastStats.running?lastStats.activeQuality:processor.configuration().quality)),28,settingsY+318,584,18,juce::Justification::left);
    }
}
void ShareStreamEditor::resized(){
    const int width=640;viewport.setBounds(0,81,width,getHeight()-138);
    monitorY=330+static_cast<int>(people.size())*58;settingsY=monitorY+134;
    content.setSize(width,settingsY+(settingsOpen?354:60));
    send.setBounds(34,22,282,36);receive.setBounds(processor.standalone()?34:324,22,processor.standalone()?572:282,36);
    status.setBounds(48,166,544,28);create.setBounds(48,200,266,34);join.setBounds(326,200,266,34);copy.setBounds(48,200,342,34);connect.setBounds(402,200,190,34);
    monitor.setBounds(42,monitorY+26,570,44);gain.setBounds(480,monitorY,132,26);peak.setBounds(400,monitorY+73,212,20);hint.setBounds(28,monitorY+100,584,20);
    settings.setButtonText("Audio & connection settings");settings.setBounds(28,settingsY,584,40);
    for(auto* c:std::initializer_list<juce::Component*>{&serverLabel,&server,&portLabel,&port,&roomLabel,&room,&bufferLabel,&buffer,&qualityLabel,&quality,&stats,&newRoom,&paste})c->setVisible(settingsOpen);
    audioSettings.setVisible(settingsOpen && processor.standalone());
    const int y=settingsY+56;
    serverLabel.setBounds(28,y,420,18);portLabel.setBounds(478,y,134,18);server.setBounds(28,y+23,436,40);port.setBounds(478,y+23,134,40);
    roomLabel.setBounds(28,y+78,280,18);room.setBounds(28,y+101,438,40);newRoom.setBounds(478,y+101,134,40);
    qualityLabel.setBounds(28,y+158,140,20);quality.setBounds(176,y+151,180,34);bufferLabel.setBounds(378,y+158,114,20);buffer.setBounds(498,y+151,114,34);
    paste.setBounds(28,y+201,160,32);audioSettings.setBounds(202,y+201,170,32);stats.setBounds(28,y+245,584,20);
    update.setBounds(300,getHeight()-44,100,32);collaboration.setBounds(424,getHeight()-46,188,36);
}
