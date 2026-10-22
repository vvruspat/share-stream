#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include "StreamEngine.h"
#include "ParticipantPresence.h"
#include "RoomDirectory.h"
#include <limits>

class ShareStreamProcessor final : public juce::AudioProcessor {
public:
    ShareStreamProcessor();
    ~ShareStreamProcessor() override = default;
    void prepareToPlay(double, int) override;
    void releaseResources() override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    bool isBusesLayoutSupported(const BusesLayout&) const override;
    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }
    const juce::String getName() const override { return "Share Stream"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    // A network source may produce audio at any time, even after silent input.
    // Advertise this before Connect/Listen so hosts don't cache a zero tail.
    double getTailLengthSeconds() const override { return std::numeric_limits<double>::infinity(); }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}
    void getStateInformation(juce::MemoryBlock&) override;
    void setStateInformation(const void*, int) override;
    sharestream::Connection configuration() const;
    void setConfiguration(const sharestream::Connection&);
    bool start();
    void stop();
    sharestream::Statistics statistics() const;
    std::array<float,2> monitorPeaks() const;
    double currentSampleRate() const { return meterSampleRate.load(); }
    sharestream::ParticipantPresence::State participants() const;
    juce::String participantId() const;
    juce::String participantToken() const;
    juce::URL collaborationURL();
    bool standalone() const { return juce::JUCEApplicationBase::isStandaloneApp(); }
    juce::AudioProcessorValueTreeState parameters;
    sharestream::RoomDirectory directory;
private:
    sharestream::StreamEngine engine;
    mutable std::mutex configMutex;
    sharestream::Connection config;
    std::atomic<bool> listen {false};
    std::atomic<bool> connectionRequested {false};
    juce::SmoothedValue<float,juce::ValueSmoothingTypes::Linear> monitorGain {1.0f};
    const std::atomic<float>* sendMonitorValue=nullptr;
    const std::atomic<float>* listenMonitorValue=nullptr;
    std::array<std::atomic<float>,2> monitorPeak {};
    std::atomic<juce::int64> meterTime {0};
    std::atomic<double> meterSampleRate {0};
    sharestream::ParticipantPresence presence;
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(ShareStreamProcessor)
};
