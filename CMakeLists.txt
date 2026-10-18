cmake_minimum_required(VERSION 3.22)
if(APPLE)
  set(CMAKE_OSX_DEPLOYMENT_TARGET "12.0" CACHE STRING "Minimum macOS version")
  set(CMAKE_OSX_ARCHITECTURES "arm64;x86_64" CACHE STRING "macOS architectures")
endif()
project(ShareStream VERSION 0.2.0 LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
include(FetchContent)
FetchContent_Declare(JUCE GIT_REPOSITORY https://github.com/juce-framework/JUCE.git GIT_TAG 8.0.4 GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(JUCE)

add_library(monocypher STATIC vendor/monocypher/monocypher.c)
target_include_directories(monocypher PUBLIC vendor/monocypher)
set_target_properties(monocypher PROPERTIES POSITION_INDEPENDENT_CODE ON)
add_library(stream_core STATIC Source/Protocol.cpp Source/StreamEngine.cpp)
set_target_properties(stream_core PROPERTIES POSITION_INDEPENDENT_CODE ON)
target_include_directories(stream_core PUBLIC Source)
target_compile_definitions(stream_core PUBLIC JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_MODAL_LOOPS_PERMITTED=0)
target_link_libraries(stream_core PUBLIC monocypher juce::juce_audio_basics juce::juce_core)

juce_add_plugin(ShareStream
  COMPANY_NAME "Share Stream" BUNDLE_ID "audio.sharestream.plugin"
  PLUGIN_MANUFACTURER_CODE Shst PLUGIN_CODE Ss01
  FORMATS VST3 AU PRODUCT_NAME "Share Stream"
  IS_SYNTH FALSE NEEDS_MIDI_INPUT FALSE NEEDS_MIDI_OUTPUT FALSE IS_MIDI_EFFECT FALSE
  AU_MAIN_TYPE kAudioUnitType_Effect
  COPY_PLUGIN_AFTER_BUILD FALSE
  MICROPHONE_PERMISSION_ENABLED FALSE
  HARDENED_RUNTIME_ENABLED TRUE
  VST3_CATEGORIES Fx Network)
target_sources(ShareStream PRIVATE Source/PluginProcessor.cpp Source/PluginEditor.cpp)
target_compile_definitions(ShareStream PUBLIC JUCE_VST3_CAN_REPLACE_VST2=0)
target_link_libraries(ShareStream PRIVATE stream_core juce::juce_audio_utils juce::juce_recommended_config_flags)

juce_add_gui_app(ShareStreamReceiver PRODUCT_NAME "Share Stream"
  COMPANY_NAME "Share Stream" BUNDLE_ID "audio.sharestream.receiver"
  MICROPHONE_PERMISSION_ENABLED FALSE HARDENED_RUNTIME_ENABLED TRUE)
target_sources(ShareStreamReceiver PRIVATE Source/Standalone.cpp Source/PluginProcessor.cpp Source/PluginEditor.cpp)
target_compile_definitions(ShareStreamReceiver PRIVATE JUCE_STANDALONE_APPLICATION=1 JUCE_VST3_CAN_REPLACE_VST2=0)
target_link_libraries(ShareStreamReceiver PRIVATE stream_core juce::juce_audio_utils juce::juce_recommended_config_flags)

enable_testing()
add_executable(stream_tests Tests/StreamTests.cpp)
target_link_libraries(stream_tests PRIVATE stream_core)
add_test(NAME stream_core COMMAND stream_tests)
add_executable(stream_probe Tests/StreamProbe.cpp)
target_link_libraries(stream_probe PRIVATE stream_core)

juce_add_console_app(plugin_probe PRODUCT_NAME "Share Stream Plugin Probe")
target_sources(plugin_probe PRIVATE Tests/PluginProbe.cpp)
target_compile_definitions(plugin_probe PRIVATE JUCE_PLUGINHOST_VST3=1 JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
target_link_libraries(plugin_probe PRIVATE juce::juce_audio_processors)
if(APPLE)
  set_target_properties(plugin_probe PROPERTIES OSX_ARCHITECTURES "${CMAKE_HOST_SYSTEM_PROCESSOR}")
endif()
