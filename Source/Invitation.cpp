#include "Invitation.h"
#include <juce_core/juce_core.h>

namespace sharestream {
static bool validHost(const juce::String& host) {
    return host.isNotEmpty() && host.length() <= 253 && host.containsOnly("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-");
}
static std::optional<RelayAddress> relayAddress(const juce::String& host, const juce::String& port) {
    if (!validHost(host) || port.isEmpty() || port.length() > 5 || !port.containsOnly("0123456789")) return {};
    const auto number = port.getIntValue();
    if (number < 1 || number > 65535) return {};
    return RelayAddress {canonicalRelayHost(host.toStdString()), number};
}
std::optional<Invitation> parseInvitation(const std::string& value) {
    const auto text = juce::String(value).trim();
    if (parseRoom(text.toStdString())) return Invitation {text.toLowerCase().toStdString(), {}};
    Invitation result;
    if (text.startsWithIgnoreCase("sharestream://")) {
        const auto rest = text.substring(14), authority = rest.upToFirstOccurrenceOf("/", false, false);
        result.code = rest.fromFirstOccurrenceOf("/", false, false).toLowerCase().toStdString();
        result.relay = relayAddress(authority.upToLastOccurrenceOf(":", false, false), authority.fromLastOccurrenceOf(":", false, false));
        if (!result.relay || !parseRoom(result.code)) return {};
        return result;
    }
    if (!text.startsWithIgnoreCase("https://stream.whitesquirrel.digital/#")) return {};
    auto fragment = text.fromFirstOccurrenceOf("#", false, false);
    // Older native clients escaped the whole fragment when opening a browser.
    // Unwrap only that form; never turn an encoded value into field separators.
    for (int layer = 0; layer < 2 && !fragment.containsChar('='); ++layer) {
        for (int i = 0; i < fragment.length(); ++i) {
            if (fragment[i] != '%') continue;
            if (i + 2 >= fragment.length() || juce::CharacterFunctions::getHexDigitValue(fragment[i + 1]) < 0
                || juce::CharacterFunctions::getHexDigitValue(fragment[i + 2]) < 0) return {};
            i += 2;
        }
        const auto decoded = juce::URL::removeEscapeChars(fragment);
        if (decoded == fragment) break;
        fragment = decoded;
    }
    juce::StringPairArray parameters;
    for (const auto& field : juce::StringArray::fromTokens(fragment, "&", "")) {
        const auto name = juce::URL::removeEscapeChars(field.upToFirstOccurrenceOf("=", false, false));
        if (parameters.containsKey(name)) return {};
        parameters.set(name, juce::URL::removeEscapeChars(field.fromFirstOccurrenceOf("=", false, false)));
    }
    result.code = parameters["room"].toLowerCase().toStdString();
    if (!parseRoom(result.code)) return {};
    if (parameters.containsKey("relay") || parameters.containsKey("port")) {
        result.relay = relayAddress(parameters["relay"], parameters["port"]);
        if (!result.relay) return {};
    }
    return result;
}
std::string invitationLink(const Invitation& invite, bool joinChat) {
    if (!parseRoom(invite.code)) return {};
    auto link = "https://stream.whitesquirrel.digital/#room=" + juce::String(invite.code).toLowerCase();
    if (invite.relay) {
        if (!validHost(invite.relay->host) || invite.relay->port < 1 || invite.relay->port > 65535) return {};
        link += "&relay=" + juce::URL::addEscapeChars(canonicalRelayHost(invite.relay->host), true) + "&port=" + juce::String(invite.relay->port);
    }
    if (joinChat) link += "&join=1";
    return link.toStdString();
}
}
