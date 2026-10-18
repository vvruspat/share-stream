cmake_minimum_required(VERSION 3.22)
if(APPLE)
  set(CMAKE_OSX_DEPLOYMENT_TARGET "12.0" CACHE STRING "Minimum macOS version")
  set(CMAKE_OSX_ARCHITECTURES "arm64;x86_64" CACHE STRING "macOS architectures")
endif()
project(ShareStream VERSION 0.3.1 LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
include(FetchContent)
FetchContent_Declare(JUCE GIT_REPOSITORY https://github.com/juce-framework/JUCE.git GIT_TAG 8.0.4 GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(JUCE)

add_library(monocypher STATIC vendor/monocypher/monocypher.c)
target_include_directories(monocypher PUBLIC vendor/monocypher)
set_target_properties(monocypher PROPERTIES POSITION_INDEPENDENT_CODE ON)
add_library(stream_core STATIC Source/Protocol.cpp Source/StreamEngine.cpp Source/Invitation.cpp)
set_target_properties(stream_core PROPERTIES POSITION_INDEPENDENT_CODE ON)
target_include_directories(stream_core PUBLIC Source)
target_compile_definitions(stream_core PUBLIC JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_MODAL_LOOPS_PERMITTED=0 SHARE_STREAM_VERSION="${PROJECT_VERSION}")
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
  VST3_CATEGORIES Fx Network Generator)
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
target_compile_definitions(stream_tests PRIVATE SHARE_STREAM_INVITE_FIXTURES="${CMAKE_CURRENT_SOURCE_DIR}/Tests/Invitations.json")
add_test(NAME stream_core COMMAND stream_tests)
add_executable(stream_probe Tests/StreamProbe.cpp)
target_link_libraries(stream_probe PRIVATE stream_core)

juce_add_console_app(plugin_probe PRODUCT_NAME "Share Stream Plugin Probe")
target_sources(plugin_probe PRIVATE Tests/PluginProbe.mm)
target_compile_definitions(plugin_probe PRIVATE JUCE_PLUGINHOST_VST3=1 JUCE_PLUGINHOST_AU=1 JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
target_link_libraries(plugin_probe PRIVATE stream_core juce::juce_audio_processors)
juce_add_console_app(processor_tests PRODUCT_NAME "Share Stream Processor Tests")
target_sources(processor_tests PRIVATE Tests/ProcessorTests.cpp Source/PluginProcessor.cpp Source/PluginEditor.cpp)
target_include_directories(processor_tests PRIVATE Source)
target_link_libraries(processor_tests PRIVATE stream_core juce::juce_audio_utils)
target_compile_definitions(processor_tests PRIVATE SHARE_STREAM_RELAY_SOURCE="${CMAKE_CURRENT_SOURCE_DIR}/server/relay.py")
add_dependencies(processor_tests plugin_probe ShareStream_VST3)
add_test(NAME processor_receive COMMAND processor_tests "$<TARGET_FILE:plugin_probe>" "${CMAKE_CURRENT_BINARY_DIR}/ShareStream_artefacts/Release/VST3/Share Stream.vst3")
set_tests_properties(processor_receive PROPERTIES TIMEOUT 60)
if(APPLE)
  target_link_libraries(plugin_probe PRIVATE "-framework CoreAudioKit")
  set_target_properties(plugin_probe PROPERTIES OSX_ARCHITECTURES "${CMAKE_HOST_SYSTEM_PROCESSOR}")
  set_target_properties(processor_tests PROPERTIES OSX_ARCHITECTURES "${CMAKE_HOST_SYSTEM_PROCESSOR}")
endif()
