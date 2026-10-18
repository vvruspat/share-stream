export interface RelayAddress {
  host: string;
  port: number;
}
export interface Invitation {
  code: string;
  relay?: RelayAddress;
  autoJoin: boolean;
}
export const defaultRelay: RelayAddress = { host: "13.140.153.191", port: 48100 };
const validCode = /^[a-f\d]{32}$/i;
function parseRelay(host: string, port: string): RelayAddress {
  if (
    !/^[a-z\d.-]{1,253}$/i.test(host) ||
    !/^\d{1,5}$/.test(port) ||
    Number(port) < 1 ||
    Number(port) > 65535
  )
    throw new Error("Invalid relay address in the invite.");
  return { host, port: Number(port) };
}
export function parseInvitation(value: string): Invitation {
  const text = value.trim();
  if (validCode.test(text)) return { code: text.toLowerCase(), autoJoin: false };
  try {
    const url = new URL(text);
    if (
      url.protocol === "sharestream:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      validCode.test(url.pathname.slice(1))
    ) {
      return {
        code: url.pathname.slice(1).toLowerCase(),
        relay: parseRelay(url.hostname, url.port),
        autoJoin: false,
      };
    }
    if (url.protocol === "https:" || url.protocol === "http:") {
      const parameters = new URLSearchParams(url.hash.slice(1));
      if ([...parameters.keys()].some((key) => parameters.getAll(key).length !== 1))
        throw new Error("Duplicate invite parameter");
      const code = parameters.get("room");
      if (code && validCode.test(code))
        return {
          code: code.toLowerCase(),
          autoJoin: parameters.get("join") === "1",
          ...(parameters.has("relay") || parameters.has("port")
            ? { relay: parseRelay(parameters.get("relay") || "", parameters.get("port") || "") }
            : {}),
        };
    }
  } catch {
    /* Show one actionable error without echoing the private invite. */
  }
  throw new Error("Paste a Share Stream invite or a 32-character room code.");
}
export function invitationLink(
  invite: Pick<Invitation, "code" | "relay">,
  origin = "https://stream.whitesquirrel.digital",
  autoJoin = true,
): string {
  if (!validCode.test(invite.code)) throw new Error("Invalid room code.");
  const relay = invite.relay || defaultRelay;
  parseRelay(relay.host, String(relay.port));
  const parameters = new URLSearchParams({
    room: invite.code.toLowerCase(),
    relay: relay.host,
    port: String(relay.port),
  });
  if (autoJoin) parameters.set("join", "1");
  return `${origin}/#${parameters}`;
}
