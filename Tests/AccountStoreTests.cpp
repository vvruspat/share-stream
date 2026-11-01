#include "AccountStore.h"
#include <barrier>
#include <iostream>
#include <mutex>
#include <thread>
#include <vector>

int main() {
    using sharestream::AccountStore;
    if(juce::SystemStats::getEnvironmentVariable("SHARE_STREAM_ACCOUNT_FILE",{}).isEmpty())return 2;
    constexpr int workers=8,iterations=25;
    const auto before=AccountStore::read();
    const auto initial=static_cast<int>(before["counter"]);
    std::barrier ready(workers);
    std::mutex mutex;juce::String failure;
    std::vector<std::thread> threads;
    for(int index=0;index<workers;++index)threads.emplace_back([&]{
        ready.arrive_and_wait();
        try {
            for(int iteration=0;iteration<iterations;++iteration)AccountStore::update([](juce::DynamicObject& value){
                const auto previous=static_cast<int>(value.getProperty("counter"));
                // Keep independent callers inside the read/modify/write region
                // together if the lock fails to exclude threads in one process.
                juce::Thread::sleep(1);
                value.setProperty("counter",previous+1);
            });
        }catch(const juce::String& error){std::lock_guard guard(mutex);failure=error;}
    });
    for(auto& thread:threads)thread.join();
    if(failure.isNotEmpty()){std::cerr<<failure<<'\n';return 1;}
    const auto after=AccountStore::read();
    if(static_cast<int>(after["counter"])!=initial+workers*iterations
        || juce::JSON::toString(before["accounts"])!=juce::JSON::toString(after["accounts"])) {
        std::cerr<<"Concurrent account-store threads lost an update.\n";return 1;
    }
    std::cout<<"PASS: eight threads retain all 200 account-store updates\n";
}
