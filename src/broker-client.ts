import jwt from "jsonwebtoken";
import { ConnectionRequired, SafeError, type Resolver } from "./api-client.js";
export function config(env: NodeJS.ProcessEnv = process.env) {
  return {
    base: env.BROKER_BASE_URL ?? "https://connectionsbroker.agenticledger.ai",
    namespace: env.BROKER_CLIENT_NAMESPACE ?? "",
    bearer: env.BROKER_INSTALL_BEARER ?? "",
    key: env.BROKER_JWT_KEY ?? "",
  };
}
export function configured(c = config()) {
  return (
    !!(c.namespace && c.bearer && c.key) &&
    c.base === "https://connectionsbroker.agenticledger.ai"
  );
}
export function resolver(
  principal: string,
  account = "",
  c = config(),
  fetcher: typeof fetch = fetch,
): Resolver {
  return async () => {
    if (!configured(c) || !principal)
      throw new SafeError(
        "broker_unconfigured",
        "Broker identity and explicit caller principal are required.",
      );
    const call = async (path: string) => {
      try {
        const r = await fetcher(c.base + path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${c.bearer}`,
            "X-Broker-Token": jwt.sign(
              { clientNamespace: c.namespace, principal },
              c.key,
              { algorithm: "HS256", expiresIn: 60 },
            ),
          },
          body: JSON.stringify({
            provider: "dropbox",
            ...(account ? { account } : {}),
          }),
          signal: AbortSignal.timeout(15000),
          redirect: "error",
        });
        if (!r.ok) {
          await r.body?.cancel();
          return { status: r.status, data: {} as Record<string, unknown> };
        }
        const raw = await r.text();
        if (raw.length > 100000) throw new Error();
        return {
          status: r.status,
          data: JSON.parse(raw) as Record<string, unknown>,
        };
      } catch {
        throw new SafeError(
          "broker_unavailable",
          "Connections Broker unavailable. Retry later.",
        );
      }
    };
    const token = await call("/token");
    if (token.status === 404) {
      const connect = await call("/connect");
      const link = connect.data.authorizeUrl;
      if (connect.status === 200 && typeof link === "string") {
        const u = new URL(link);
        if (
          u.protocol !== "https:" ||
          !["www.dropbox.com", "dropbox.com"].includes(u.hostname) ||
          u.pathname !== "/oauth2/authorize"
        )
          throw new SafeError(
            "invalid_connect_url",
            "Unexpected broker consent URL.",
          );
        throw new ConnectionRequired(link);
      }
      throw new SafeError(
        "provider_unconfigured",
        "Dropbox OAuth app is not ready in the broker. Ask the broker operator to configure it.",
      );
    }
    if (
      token.status !== 200 ||
      typeof token.data.accessToken !== "string" ||
      !token.data.accessToken
    )
      throw new SafeError(
        token.status === 401
          ? "broker_auth_failed"
          : "broker_token_unavailable",
        "Broker could not resolve Dropbox credentials. Reconnect or contact the operator.",
      );
    return token.data.accessToken;
  };
}
