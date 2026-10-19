#include "Updater.h"
#include <iostream>
// Acceptance probe against the actual public release, using the production
// downloader and verifier. Deliberately never launches or installs anything.
int main() {
    sharestream::Updater updater("0.0.1",false);
    auto wait=[&](int seconds) {
        auto until=juce::Time::currentTimeMillis()+seconds*1000LL;
        juce::String last;
        while(juce::Time::currentTimeMillis()<until) {
            auto state=updater.state();
            if(state.text!=last) {last=state.text;std::cout<<last<<std::endl;}
            if(!state.busy)return state;
            juce::Thread::sleep(50);
        }
        return updater.state();
    };
    updater.check();
    if(!wait(30).available)return 1;
    updater.check(true);
    auto state=wait(180);
    if(!state.ready || state.busy)return 1;
    std::cout<<"PASS: public GitHub version, installer download, SHA-256 and platform signature verification; nothing installed\n";
}
