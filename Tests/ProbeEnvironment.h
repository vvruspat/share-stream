#pragma once
#include <cstdlib>

// A test host always starts with a fresh disconnected processor, including
// when invoked directly after CTest or against an installed plug-in. Otherwise
// the saved Listen role/monitor gain can change the Send passthrough fixture,
// and the test can overwrite the user's own remembered room on destruction.
inline bool isolateProbeFromSavedSessions() {
#if JUCE_WINDOWS
    return ::_putenv_s("SHARE_STREAM_PRESENCE_URL","disabled")==0
        && ::_putenv_s("SHARE_STREAM_ACCOUNT_FILE","")==0;
#else
    return ::setenv("SHARE_STREAM_PRESENCE_URL","disabled",1)==0
        && ::unsetenv("SHARE_STREAM_ACCOUNT_FILE")==0;
#endif
}
