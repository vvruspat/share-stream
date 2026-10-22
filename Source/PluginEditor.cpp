#include "PluginEditor.h"
#include "Invitation.h"

static const juce::Colour background(0xff101615), panel(0xff1a2421), green(0xffb2f5ca), text(0xffedf5f0), muted(0xff91a49a), border(0xff304139);
static void labelStyle(juce::Label& l,float size=14) {l.setColour(juce::Label::textColourId,muted);l.setFont(juce::Font(juce::FontOptions(size)));l.setBorderSize(juce::BorderSize<int>(0));}
void MonitorLookAndFeel::drawButtonBackground(juce::Graphics& g,juce::Button& b,const juce::Colour& colour,bool over,bool down) {
    if(b.getComponentID()=="disclosure" || b.getComponentID()=="footer" || b.getComponentID()=="account-menu" || b.getComponentID()=="room-picker" || b.getComponentID()=="roster")return;
    juce::LookAndFeel_V4::drawButtonBackground(g,b,colour,over,down);
}
void MonitorLookAndFeel::drawButtonText(juce::Graphics& g,juce::TextButton& b,bool over,bool down) {
    const auto id=b.getComponentID();
    if(id=="account-menu" || id=="room-picker" || id=="roster") {
        g.setColour(b.isEnabled()?(over?green:text):muted);
        if(id=="account-menu") {
            g.setColour(border);g.fillEllipse(0,2,30,30);g.setColour(text);g.setFont(juce::Font(juce::FontOptions(14)));
            g.drawText(b.getButtonText().substring(0,1).toUpperCase(),0,2,30,30,juce::Justification::centred);
            g.drawText(b.getButtonText(),40,0,b.getWidth()-58,b.getHeight(),juce::Justification::left,true);
        } else if(id=="room-picker") {
            g.setFont(juce::Font(juce::FontOptions(22).withStyle("Bold")));
            g.drawText(b.getButtonText(),0,0,b.getWidth()-26,b.getHeight(),juce::Justification::left,true);
        }
        if(id!="roster") {juce::Path arrow;const float x=b.getWidth()-14.0f,y=b.getHeight()*0.5f;arrow.startNewSubPath(x-4,y-2);arrow.lineTo(x,y+2);arrow.lineTo(x+4,y-2);g.strokePath(arrow,juce::PathStrokeType(1.4f));}
        if(b.hasKeyboardFocus(true)){g.setColour(green);g.drawRoundedRectangle(b.getLocalBounds().toFloat().reduced(1),4,1);}
        return;
    }
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
    theme.setColour(juce::TextButton::buttonColourId,panel);theme.setColour(juce::TextButton::buttonOnColourId,border);
    theme.setColour(juce::TextButton::textColourOffId,text);theme.setColour(juce::TextButton::textColourOnId,text);
    theme.setColour(juce::ComboBox::backgroundColourId,panel);theme.setColour(juce::ComboBox::textColourId,text);theme.setColour(juce::ComboBox::outlineColourId,border);
    theme.setColour(juce::PopupMenu::backgroundColourId,panel);theme.setColour(juce::PopupMenu::textColourId,text);
    setLookAndFeel(&theme);
    addAndMakeVisible(viewport);viewport.setViewedComponent(&content,false);viewport.setScrollBarsShown(true,false);
    content.draw=[this](juce::Graphics& g){paintContent(g);};
    for(auto* button:{&send,&receive,&connect,&newRoom,&paste,&audioSettings,&roomPicker,&roomMenu,&invite,&participants}) {
        content.addAndMakeVisible(button);button->setMouseCursor(juce::MouseCursor::PointingHandCursor);
    }
    for(auto* button:{&collaboration,&update,&settings,&accountMenu}) {addAndMakeVisible(button);button->setMouseCursor(juce::MouseCursor::PointingHandCursor);}
    send.setComponentID("send-role");receive.setComponentID("listen-role");connect.setComponentID("music-connect");
    roomPicker.setComponentID("room-picker");roomPicker.setTitle("Choose a room");roomPicker.onClick=[this]{showRoomPicker();};
    roomMenu.setTitle("Room actions");roomMenu.setTooltip("Rename, create or open a room");roomMenu.onClick=[this]{showRoomMenu();};
    invite.setTitle("Invite participants");invite.onClick=[this]{showRoomMenu(true);};
    participants.setComponentID("roster");participants.setTitle("Participants");participants.onClick=[this]{showParticipants();};
    accountMenu.setComponentID("account-menu");accountMenu.setTitle("Accounts");accountMenu.onClick=[this]{showAccountMenu();};
    collaboration.setComponentID("voice-screen");collaboration.onClick=[this]{openCollaboration();};
    collaboration.setTooltip("Open this room in your browser. Microphone and screen stay off until you enable them.");
    audioSettings.onClick=[this]{if(onAudioSettings)onAudioSettings();};
    for(auto* editor:{&server,&port,&room}) {
        content.addAndMakeVisible(editor);editor->setColour(juce::TextEditor::backgroundColourId,panel);editor->setColour(juce::TextEditor::textColourId,text);
        editor->setColour(juce::TextEditor::outlineColourId,border);editor->setColour(juce::TextEditor::focusedOutlineColourId,green);
        editor->setFont(juce::Font(juce::FontOptions(14)));editor->setIndents(10,11);editor->onTextChange=[this]{saveConfiguration();};
    }
    server.setTitle("Relay server");port.setTitle("UDP port");room.setTitle("Private room code");
    port.setInputRestrictions(5,"0123456789");
    auto cfg=processor.configuration();server.setText(cfg.host,false);port.setText(juce::String(cfg.port),false);room.setText(cfg.code,false);
    content.addAndMakeVisible(buffer);for(int ms:{5,10,20,40,80,100})buffer.addItem(juce::String(ms)+" ms",ms);
    buffer.setSelectedId(cfg.jitterMs,juce::dontSendNotification);buffer.onChange=[this]{saveConfiguration();};
    content.addAndMakeVisible(quality);for(int value=0;value<3;++value)quality.addItem(sharestream::qualityName(static_cast<sharestream::AudioQuality>(value)),value+1);
    quality.setSelectedId(static_cast<int>(cfg.quality)+1,juce::dontSendNotification);quality.onChange=[this]{saveConfiguration();};
    quality.setTooltip("The sender chooses the stream format. PCM 24-bit and Opus clip above 0 dBFS.");
    content.addAndMakeVisible(monitor);monitor.setComponentID("local-monitor");monitor.setSliderStyle(juce::Slider::LinearHorizontal);monitor.setTextBoxStyle(juce::Slider::NoTextBox,false,0,0);
    monitor.setDoubleClickReturnValue(true,0);monitor.setTitle("Local monitor");monitor.setTooltip("Only changes your local output. Double-click for 0 dB. Gain -60 to +6 dB; L/R bars show the output signal in dBFS.");
    monitor.onValueChange=[this]{gain.setText(monitor.getValue()<=-60?"Mute":juce::String(monitor.getValue(),1)+" dB",juce::dontSendNotification);};
    for(auto* l:{&serverLabel,&portLabel,&roomLabel,&bufferLabel,&qualityLabel,&status,&stats,&hint,&gain,&peak,&directoryStatus}){content.addAndMakeVisible(l);labelStyle(*l);}
    labelStyle(status,13);labelStyle(hint,12);labelStyle(stats,11);labelStyle(peak,12);labelStyle(directoryStatus,12);
    gain.setJustificationType(juce::Justification::right);peak.setJustificationType(juce::Justification::right);
    serverLabel.setText("Relay server",juce::dontSendNotification);portLabel.setText("UDP port",juce::dontSendNotification);roomLabel.setText("Private room code",juce::dontSendNotification);
    bufferLabel.setText("Network buffer",juce::dontSendNotification);qualityLabel.setText("Stream quality",juce::dontSendNotification);
    send.onClick=[this]{if(processor.statistics().running)return;auto c=processor.configuration();c.role=sharestream::Role::send;processor.setConfiguration(c);updateMode();timerCallback();};
    receive.onClick=[this]{if(processor.statistics().running)return;auto c=processor.configuration();c.role=sharestream::Role::receive;processor.setConfiguration(c);updateMode();timerCallback();};
    send.setTooltip("Send music from this track. Start sending when you are ready.");receive.setTooltip("Receive the room's music into this track.");
    connect.onClick=[this]{if(processor.statistics().running)processor.stop();else{saveConfiguration();rememberRoom();processor.start();}timerCallback();};
    paste.onClick=[this]{performRoomAction(RoomAction::pasteInvite);};
    newRoom.onClick=[this]{if(!processor.statistics().running)room.setText(sharestream::newRoomCode());};
    settings.onClick=[this]{settingsOpen=!settingsOpen;settings.setToggleState(settingsOpen,juce::dontSendNotification);resized();repaint();};
    settings.setTitle("Audio and connection settings");settings.setComponentID("footer");update.setComponentID("footer");
    connect.setColour(juce::TextButton::buttonColourId,green);connect.setColour(juce::TextButton::textColourOffId,background);
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
    setSize(560,660);updateMode();startTimerHz(20);timerCallback();
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
    rememberRoom();
    notice="Invitation copied. Music starts only when you connect.";noticeTicks=60;timerCallback();
}
bool ShareStreamEditor::loadInvite(const juce::String& value){
    const auto invite=sharestream::parseInvitation(value.toStdString());if(!invite)return false;
    processor.stop();if(invite->relay){server.setText(invite->relay->host,false);port.setText(juce::String(invite->relay->port),false);}
    room.setText(invite->code,false);saveConfiguration();
    rememberRoom();
    notice="Room selected. Connect music when you are ready.";noticeTicks=40;timerCallback();return true;
}
void ShareStreamEditor::pasteInvite(){if(!loadInvite(juce::SystemClipboard::getTextFromClipboard())){notice="Copy a Share Stream invite or session code first.";noticeTicks=60;}}
void ShareStreamEditor::joinSession(){
    const auto clipboard=juce::SystemClipboard::getTextFromClipboard();if(loadInvite(clipboard))return;
    auto* dialog=new juce::AlertWindow("Open a room","Paste an invitation. You can connect music afterwards.",juce::MessageBoxIconType::NoIcon);
    dialog->addTextEditor("invite",{},"Invite or session code");dialog->addButton("Open room",1,juce::KeyPress(juce::KeyPress::returnKey));dialog->addButton("Cancel",0,juce::KeyPress(juce::KeyPress::escapeKey));
    dialog->enterModalState(true,juce::ModalCallbackFunction::create([safe=juce::Component::SafePointer<ShareStreamEditor>(this),dialog](int result){
        if(safe && result==1 && !safe->loadInvite(dialog->getTextEditorContents("invite"))){safe->notice="That invitation is not valid. Try opening it again.";safe->noticeTicks=80;}
    }),true);
}
void ShareStreamEditor::accountDialog(){
    auto* dialog=new juce::AlertWindow("Share Stream account","Sign in or create an account. Use a password of at least 10 characters. Saved accounts can be switched on this device.",juce::MessageBoxIconType::NoIcon);
    dialog->addTextEditor("username",{},"Username");dialog->addTextEditor("password",{},"Password",true);
    dialog->addButton("Sign in",1,juce::KeyPress(juce::KeyPress::returnKey));dialog->addButton("Create account",2);dialog->addButton("Cancel",0,juce::KeyPress(juce::KeyPress::escapeKey));
    dialog->enterModalState(true,juce::ModalCallbackFunction::create([safe=juce::Component::SafePointer<ShareStreamEditor>(this),dialog](int result){
        if(!safe || result==0)return;
        auto* body=new juce::DynamicObject;body->setProperty("username",dialog->getTextEditorContents("username"));body->setProperty("password",dialog->getTextEditorContents("password"));
        safe->processor.stop();safe->processor.directory.request(result==2?"/api/accounts/register":"/api/accounts/login",juce::var(body));
    }),true);
}
void ShareStreamEditor::selectRoom(const juce::var& saved){
    if(room.getText()!=saved["code"].toString())processor.stop();server.setText(saved["host"].toString(),false);port.setText(saved["port"].toString(),false);room.setText(saved["code"].toString(),false);saveConfiguration();
    notice="Room selected. Music and voice connect separately.";noticeTicks=100;
}
void ShareStreamEditor::rememberRoom(){
    const auto c=processor.configuration();
    if(!processor.directory.state().user.isObject() || processor.directory.participant(c.code).isNotEmpty())return;
    auto* body=new juce::DynamicObject;body->setProperty("code",juce::String(c.code));body->setProperty("host",juce::String(c.host));body->setProperty("port",c.port);
    processor.directory.request("/api/rooms/accept",juce::var(body));
}
void ShareStreamEditor::roomDialog(int action){
    const auto state=processor.directory.state();juce::var selected;
    if(auto* list=state.rooms.getArray())for(const auto& item:*list)if(item["code"].toString()==room.getText())selected=item;
    if(action>=2 && !selected.isObject())return;
    const juce::String title=action==0?"Create room":action==1?"Save room":action==2?"Rename room":"Invite user";
    auto* dialog=new juce::AlertWindow(title,action==3?"The room will appear in this user's saved rooms. Anyone with Copy invite can also save and join it.":"Rooms remain saved when everyone disconnects.",juce::MessageBoxIconType::NoIcon);
    dialog->addTextEditor("value",action==2?selected["name"].toString():juce::String(),action==3?"Username":"Room name");
    dialog->addButton(action==3?"Invite":"Save",1,juce::KeyPress(juce::KeyPress::returnKey));dialog->addButton("Cancel",0,juce::KeyPress(juce::KeyPress::escapeKey));
    dialog->enterModalState(true,juce::ModalCallbackFunction::create([safe=juce::Component::SafePointer<ShareStreamEditor>(this),dialog,action,selected](int result){
        if(!safe || result!=1)return;
        auto* body=new juce::DynamicObject;const auto value=dialog->getTextEditorContents("value");
        body->setProperty(action==3?"username":"name",value);
        juce::String path="/api/rooms",method="POST";
        if(action<2){const auto c=safe->processor.configuration();body->setProperty("code",action==0?juce::String(sharestream::newRoomCode()):juce::String(c.code));body->setProperty("host",juce::String(c.host));body->setProperty("port",c.port);if(action==1)path+="/accept";}
        else {path+="/"+selected["id"].toString();if(action==3)path+="/invitations";else method="PATCH";}
        safe->processor.directory.request(path,juce::var(body),method);
    }),true);
}
void ShareStreamEditor::performRoomAction(RoomAction action) {
    switch(action) {
        case RoomAction::copyInvite: copyInvite();break;
        case RoomAction::pasteInvite: pasteInvite();break;
        case RoomAction::joinRoom: joinSession();break;
        case RoomAction::createRoom:
            if(processor.directory.state().user.isObject())roomDialog(0);
            else {processor.stop();room.setText(sharestream::newRoomCode());notice="Guest room ready. Sign in to keep it in your room list.";noticeTicks=100;timerCallback();}
            break;
        case RoomAction::saveRoom: roomDialog(1);break;
        case RoomAction::renameRoom: roomDialog(2);break;
        case RoomAction::inviteUser: roomDialog(3);break;
    }
}
void ShareStreamEditor::showAccountMenu() {
    const auto state=processor.directory.state();
    if(!state.accounts.isArray() || state.accounts.getArray()->isEmpty()){accountDialog();return;}
    juce::PopupMenu menu;menu.addSectionHeader("Accounts");
    if(auto* list=state.accounts.getArray())for(int i=0;i<list->size();++i)menu.addItem(100+i,(*list)[i]["user"]["username"].toString(),!state.busy,(*list)[i]["user"]["id"]==state.user["id"]);
    menu.addSeparator();menu.addItem(1,"Add account",!state.busy);menu.addItem(2,"Sign out of this account",state.user.isObject() && !state.busy);menu.addItem(3,"Use as guest",state.user.isObject() && !state.busy);
    menu.showMenuAsync(juce::PopupMenu::Options().withTargetComponent(accountMenu),[safe=juce::Component::SafePointer<ShareStreamEditor>(this)](int choice){
        if(!safe || choice==0)return;
        if(choice==1){safe->accountDialog();return;}
        safe->processor.stop();safe->browserPending=false;
        if(choice==2)safe->processor.directory.request("/api/accounts/logout");
        else safe->processor.directory.select(choice==3?0:choice-99);
        safe->room.setText(sharestream::newRoomCode());safe->timerCallback();
    });
}
void ShareStreamEditor::showRoomPicker() {
    const auto state=processor.directory.state();juce::PopupMenu menu;menu.addSectionHeader("Your rooms");
    if(auto* list=state.rooms.getArray())for(int i=0;i<list->size();++i)menu.addItem(100+i,(*list)[i]["name"].toString(),!state.busy,(*list)[i]["code"].toString()==room.getText());
    menu.addSeparator();menu.addItem(1,state.user.isObject()?"Create room":"Create guest room",!state.busy);menu.addItem(2,"Open invitation",!state.busy);
    if(!state.user.isObject())menu.addItem(3,"Sign in to save rooms",!state.busy);
    menu.showMenuAsync(juce::PopupMenu::Options().withTargetComponent(roomPicker),[safe=juce::Component::SafePointer<ShareStreamEditor>(this),rooms=state.rooms.clone()](int choice){
        if(!safe)return;
        if(choice>=100){if(auto* list=rooms.getArray())if(choice-100<list->size())safe->selectRoom((*list)[choice-100]);}
        else if(choice==1)safe->performRoomAction(RoomAction::createRoom);
        else if(choice==2)safe->performRoomAction(RoomAction::joinRoom);
        else if(choice==3)safe->accountDialog();
    });
}
void ShareStreamEditor::showRoomMenu(bool inviteOnly) {
    const auto state=processor.directory.state();bool saved=false,owner=false;
    if(auto* list=state.rooms.getArray())for(const auto& item:*list)if(item["code"].toString()==room.getText()){saved=true;owner=static_cast<bool>(item["owner"]);}
    juce::PopupMenu menu;menu.addItem(1,"Copy invitation link",!state.busy);menu.addItem(2,"Invite by username",owner && !state.busy);
    if(!inviteOnly){menu.addSeparator();menu.addItem(3,"Rename room",owner && !state.busy);if(!saved)menu.addItem(4,"Save this room",state.user.isObject() && !state.busy);menu.addItem(5,"Create room",!state.busy);menu.addItem(6,"Open invitation",!state.busy);}
    menu.showMenuAsync(juce::PopupMenu::Options().withTargetComponent(inviteOnly?invite:roomMenu),[safe=juce::Component::SafePointer<ShareStreamEditor>(this)](int choice){
        if(!safe)return;
        switch(choice){case 1:safe->performRoomAction(RoomAction::copyInvite);break;case 2:safe->performRoomAction(RoomAction::inviteUser);break;case 3:safe->performRoomAction(RoomAction::renameRoom);break;case 4:safe->performRoomAction(RoomAction::saveRoom);break;case 5:safe->performRoomAction(RoomAction::createRoom);break;case 6:safe->performRoomAction(RoomAction::joinRoom);break;default:break;}
    });
}
void ShareStreamEditor::showParticipants() {
    juce::String details;const auto self=processor.participantId();
    for(const auto& p:people){
        const juce::String music=p.music=="sending"?"Sending music":p.music=="listening"?"Listening to music":p.music=="connecting"?"Connecting music":"Music off";
        const juce::String voice=!p.browser?"Voice off":p.speaking?"Speaking":p.mic?"Microphone on":"Microphone off";
        details+=p.name+(p.id==self?" (you)":"")+"\n"+music+" / "+voice+"\n\n";
    }
    juce::AlertWindow::showAsync(juce::MessageBoxOptions().withIconType(juce::MessageBoxIconType::NoIcon).withTitle("Participants / "+juce::String(people.size())).withMessage(details.trimEnd()).withButton("Close"),[](int){});
}
void ShareStreamEditor::openCollaboration() {
    saveConfiguration();const auto guestURL=processor.collaborationURL();
    if(guestURL.isEmpty()){notice="Enter a valid room and server in settings.";noticeTicks=100;return;}
    const auto state=processor.directory.state();
    if(!state.user.isObject()) {
        if(!guestURL.launchInDefaultBrowser()){notice="Could not open the browser.";noticeTicks=100;}
        return;
    }
    const auto c=processor.configuration();
    if(processor.directory.requestBrowserHandoff(c.code,c.host,c.port)) {
        browserPending=true;browserCode=c.code;browserAccount=state.user["id"].toString();browserSequence=state.browserSequence;
        timerCallback();
    } else {notice="Please wait for your account to finish updating.";noticeTicks=80;}
}
void ShareStreamEditor::timerCallback(){
    const auto directory=processor.directory.state();
    if(directory.selection!=directorySelection){directorySelection=directory.selection;if(directory.selected.isObject())selectRoom(directory.selected);}
    const bool signedIn=directory.user.isObject();
    accountMenu.setButtonText(signedIn?directory.user["username"].toString():"Sign in");accountMenu.setEnabled(!directory.busy);
    juce::String title="Guest room";
    if(auto* list=directory.rooms.getArray())for(const auto& saved:*list)if(saved["code"].toString()==room.getText())title=saved["name"].toString();
    roomPicker.setButtonText(title);roomPicker.setTooltip(title);roomPicker.setEnabled(!directory.busy);roomMenu.setEnabled(!directory.busy);invite.setEnabled(!directory.busy);
    directoryStatus.setText(directory.error.isNotEmpty()?directory.error:directory.notice,juce::dontSendNotification);
    directoryStatus.setColour(juce::Label::textColourId,directory.error.isNotEmpty()?juce::Colour(0xffffb19a):muted);
    if(browserPending) {
        if(browserCode!=juce::String(processor.configuration().code) || browserAccount!=directory.user["id"].toString())browserPending=false;
        else if(directory.browserSequence!=browserSequence) {
            browserPending=false;const auto url=processor.browserHandoffURL();
            if(url.isEmpty() || !url.launchInDefaultBrowser()){notice="Could not open the browser. Try Voice & screen again.";noticeTicks=100;}
        } else if(!directory.busy) {browserPending=false;notice=directory.error.isNotEmpty()?directory.error:juce::String("Could not sign in to the browser. Try again.");noticeTicks=100;}
    }
    collaboration.setButtonText(browserPending?"Opening browser...":"Voice & screen");collaboration.setEnabled(!directory.busy && !browserPending);
    const auto u=updater->state();update.setButtonText(u.available?"Update available":"Updates");update.setTooltip(u.text);update.setEnabled(!u.busy);
    if(u.ready && updater->launch(processor.standalone())){
#if JUCE_MAC || JUCE_WINDOWS
        if(processor.standalone() && juce::JUCEApplication::getInstance())juce::JUCEApplication::quit();
#endif
    }
    lastStats=processor.statistics();const bool running=lastStats.running;
    const bool sending=processor.configuration().role==sharestream::Role::send;
    for(auto* f:{&server,&port,&room})f->setReadOnly(running);
    newRoom.setEnabled(!running);paste.setEnabled(!running && !directory.busy);buffer.setEnabled(!running);
    send.setEnabled(!running);receive.setEnabled(!running);
    connect.setButtonText(running?(sending?"Stop sending":"Disconnect music"):(sending?"Start sending":"Connect music"));
    connect.setEnabled(running || !directory.busy);
    connect.setColour(juce::TextButton::buttonColourId,running?panel:green);
    connect.setColour(juce::TextButton::textColourOffId,running?text:background);
    updateMode();
    juce::String message;
    if(!lastStats.error.empty())message=lastStats.error;
    else if(!running)message=sending?"Music starts when you choose Start sending.":"Connect when you are ready to listen.";
    else if(lastStats.waitingForAudio)message="Waiting for DAW audio. Enable playback or monitoring.";
    else if(!lastStats.relay && !lastStats.direct)message="Connecting music...";
    else if(!lastStats.peer)message=sending?"Ready / waiting for listeners":"Waiting for someone to send music";
    else message=sending?"Sending to "+juce::String(lastStats.peers)+(lastStats.peers==1?" listener":" listeners"):"Listening to the room's music";
    status.setText(message,juce::dontSendNotification);status.setColour(juce::Label::textColourId,!lastStats.error.empty()?juce::Colour(0xffffb19a):muted);
    const auto rtt=lastStats.direct?lastStats.directRttMs:lastStats.rttMs;
    stats.setText((lastStats.direct?"Peer RTT ":"Relay RTT ")+(rtt>0?juce::String(rtt,1)+" ms":"-")+"  /  Buffer "+juce::String(lastStats.jitterMs,0)+" ms  /  P2P "+juce::String(lastStats.directPeers)+" / Relay "+juce::String(std::max(0,lastStats.peers-lastStats.directPeers))+"\nPackets "+juce::String(lastStats.packets)+"  /  Lost "+juce::String(lastStats.lost)+"  /  Dropouts "+juce::String(lastStats.underruns),juce::dontSendNotification);
    if(noticeTicks>0){--noticeTicks;hint.setText(notice,juce::dontSendNotification);}else hint.setText("Only changes what you hear. Others' volume stays the same.",juce::dontSendNotification);
    theme.peaks=processor.monitorPeaks();const auto max=std::max(theme.peaks[0],theme.peaks[1]);
    peak.setText(max>0?"Peak "+juce::String(juce::Decibels::gainToDecibels(max,-100.0f),1)+" dBFS":"Peak -inf dBFS",juce::dontSendNotification);
    gain.setText(monitor.getValue()<=-60?"Mute":juce::String(monitor.getValue(),1)+" dB",juce::dontSendNotification);
    auto roster=processor.participants();auto next=roster.participants;const auto id=processor.participantId();
    if(std::none_of(next.begin(),next.end(),[&](const auto& p){return p.id==id;}))next.insert(next.begin(),{id,directory.user["name"].toString().isNotEmpty()?directory.user["name"].toString():juce::String("You"),running?(lastStats.peer?(sending?"sending":"listening"):"connecting"):"",false,false,false});
    if(!roster.available && lastStats.peer)next.push_back({{},"Music partner",sending?"listening":"sending",false,false,false});
    people=std::move(next);juce::StringArray names;for(const auto& person:people)names.add(person.name);
    participants.setTooltip(names.joinIntoString(", ")+" / Show participant details");participants.setTitle("Participants / "+juce::String(people.size()));
    monitor.repaint();content.repaint();repaint();
}
void ShareStreamEditor::paint(juce::Graphics& g){
    g.fillAll(background);g.setColour(text);g.setFont(juce::Font(juce::FontOptions(22).withStyle("Bold")));g.drawText("Share Stream",24,18,250,36,juce::Justification::left);
    g.setColour(border);g.drawHorizontalLine(70,0,getWidth());g.drawHorizontalLine(getHeight()-42,24,getWidth()-24);
    const bool connected=lastStats.running && !lastStats.waitingForAudio && (lastStats.relay || lastStats.direct);
    const juce::String state=!lastStats.error.empty()?"Music connection error":!lastStats.running?"Music disconnected":connected?"Music connected":"Connecting music...";
    g.setColour(connected?green:muted);g.fillEllipse(24,getHeight()-25.0f,5,5);g.setColour(muted);g.setFont(juce::Font(juce::FontOptions(12)));
    g.drawText(state,37,getHeight()-36,250,28,juce::Justification::left);
}
void ShareStreamEditor::paintContent(juce::Graphics& g){
    g.fillAll(background);
    g.setColour(muted);g.setFont(juce::Font(juce::FontOptions(12)));g.drawText("Room",24,8,280,20,juce::Justification::left);
    const int shown=std::min(4,static_cast<int>(people.size()));int x=24;juce::StringArray names;
    for(int i=0;i<shown;++i){const auto& p=people[static_cast<size_t>(i)];g.setColour(p.speaking?green:border);g.fillEllipse(static_cast<float>(x),82,28,28);g.setColour(p.speaking?background:text);g.setFont(juce::Font(juce::FontOptions(12)));g.drawText(p.name.substring(0,1).toUpperCase(),x,82,28,28,juce::Justification::centred);x+=24;}
    for(const auto& p:people)names.add(p.name);
    const int labelX=std::max(70,x+14);g.setColour(muted);g.setFont(juce::Font(juce::FontOptions(12)));g.drawText(names.joinIntoString(", "),labelX,83,470-labelX,26,juce::Justification::left,true);
    g.drawText(juce::String(people.size())+"  >",474,83,62,26,juce::Justification::right);
    g.setColour(panel);g.fillRoundedRectangle(24,134,512,174,12);g.setColour(border);g.drawRoundedRectangle(24,134,512,174,12,1);
    g.setColour(text);g.setFont(juce::Font(juce::FontOptions(16).withStyle("Bold")));g.drawText(processor.configuration().role==sharestream::Role::send?"Music from your DAW":"Music from the room",44,189,472,24,juce::Justification::left);
    g.setColour(muted);g.setFont(juce::Font(juce::FontOptions(14)));g.drawText("Local monitor",24,monitorY,340,26,juce::Justification::left);
    g.setFont(juce::Font(juce::FontOptions(8)));g.drawText("L",24,monitorY+39,12,7,juce::Justification::left);g.drawText("R",24,monitorY+46,12,7,juce::Justification::left);
    g.setFont(juce::Font(juce::FontOptions(12)));g.drawText("Stereo output",24,monitorY+73,240,20,juce::Justification::left);
    if(settingsOpen){g.setColour(border);g.drawHorizontalLine(settingsY-14,24,536);g.setColour(muted);g.setFont(juce::Font(juce::FontOptions(11)));g.drawText("Music is encrypted / "+juce::String(sharestream::qualityName(lastStats.running?lastStats.activeQuality:processor.configuration().quality)),24,settingsY+336,512,18,juce::Justification::left);}
}
void ShareStreamEditor::resized(){
    const int width=560;viewport.setBounds(0,71,width,getHeight()-172);
    monitorY=328;settingsY=482;content.setSize(width,settingsOpen?settingsY+366:478);
    accountMenu.setBounds(374,18,162,36);
    roomPicker.setBounds(24,32,354,38);invite.setBounds(390,34,90,34);roomMenu.setBounds(492,34,44,34);participants.setBounds(24,78,512,38);
    send.setBounds(32,142,244,36);receive.setBounds(processor.standalone()?32:284,142,processor.standalone()?496:244,36);
    status.setBounds(44,217,472,28);connect.setBounds(44,258,472,34);
    monitor.setBounds(38,monitorY+26,498,44);gain.setBounds(406,monitorY,130,26);peak.setBounds(326,monitorY+73,210,20);hint.setBounds(24,monitorY+99,512,30);
    directoryStatus.setBounds(24,452,512,24);
    settings.setButtonText(settingsOpen?"Close settings":"Settings");settings.setBounds(314,getHeight()-38,108,32);
    for(auto* c:std::initializer_list<juce::Component*>{&serverLabel,&server,&portLabel,&port,&roomLabel,&room,&bufferLabel,&buffer,&qualityLabel,&quality,&stats,&newRoom,&paste})c->setVisible(settingsOpen);
    audioSettings.setVisible(settingsOpen && processor.standalone());
    const int y=settingsY;
    serverLabel.setBounds(24,y,360,20);portLabel.setBounds(430,y,106,20);server.setBounds(24,y+26,392,40);port.setBounds(430,y+26,106,40);
    roomLabel.setBounds(24,y+78,280,20);room.setBounds(24,y+104,392,40);newRoom.setBounds(430,y+104,106,40);
    qualityLabel.setBounds(24,y+162,148,24);quality.setBounds(180,y+156,180,36);bufferLabel.setBounds(24,y+206,148,24);buffer.setBounds(180,y+200,180,36);
    paste.setBounds(24,y+248,150,32);audioSettings.setBounds(190,y+248,170,32);stats.setBounds(24,y+292,512,40);
    collaboration.setBounds(24,getHeight()-90,512,44);update.setBounds(434,getHeight()-38,102,32);
}
