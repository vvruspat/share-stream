#pragma once
#include "Protocol.h"

namespace sharestream {
struct RelayAddress { std::string host; int port = defaultPort; };
struct Invitation { std::string code; std::optional<RelayAddress> relay; };
// The same fragment-only invitation opens the browser room or can be pasted in
// either native client. Legacy sharestream:// links and room codes still work.
std::optional<Invitation> parseInvitation(const std::string&);
std::string invitationLink(const Invitation&, bool joinChat = true);
}
