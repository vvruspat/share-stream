#include "AccountStore.h"
#include "Invitation.h"
#include <iostream>

int main(int argc,char** argv) {
    using sharestream::AccountStore;
    try {
        if(argc==2 && juce::String(argv[1])=="--paths") {
            auto* paths=new juce::DynamicObject;paths->setProperty("accounts",AccountStore::file().getFullPathName());
            std::cout<<juce::JSON::toString(juce::var(paths),true)<<std::endl;return 0;
        }
        std::string input;std::getline(std::cin,input);
        if(input.size()>65536)throw juce::String("Request too large.");
        const auto request=juce::JSON::parse(input);const auto operation=request["operation"].toString();
        juce::var state;
        if(operation=="put")state=AccountStore::put(request["user"],request["token"].toString());
        else if(operation=="remove")state=AccountStore::remove(request["id"].toString());
        else if(operation=="select")state=AccountStore::select(request["id"].toString());
        else if(operation=="room" || operation=="launch")state=AccountStore::openRoom(request["room"],operation=="launch");
        else if(operation=="read")state=AccountStore::read();
        else throw juce::String("Invalid account operation.");
        std::cout<<juce::JSON::toString(AccountStore::summary(state),true)<<std::endl;return 0;
    } catch(const juce::String& error) {
        auto* result=new juce::DynamicObject;result->setProperty("error",error);
        std::cout<<juce::JSON::toString(juce::var(result),true)<<std::endl;return 1;
    }
}
