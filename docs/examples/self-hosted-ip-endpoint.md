# Self-hosted IP-lookup endpoint

By default, cc-guard queries `ipinfo.io` / `api.ipify.org` / `icanhazip.com` to
detect public IP changes. Those services see your IP whenever cc-guard checks
(every network-change event).

If you'd rather not expose your usage frequency to those services, deploy a
minimal self-hosted endpoint.

## Cloudflare Worker (recommended)

**1. Create a worker** at [dash.cloudflare.com/?to=/:account/workers](https://dash.cloudflare.com/?to=/:account/workers).

**2. Paste this code:**

```js
export default {
  async fetch(request) {
    const ip = request.headers.get('CF-Connecting-IP') ?? ''
    const country = request.headers.get('CF-IPCountry') ?? ''
    return Response.json({ ip, country })
  },
}
```

**3. Deploy**, note the URL (e.g. `https://whatismyip.yourname.workers.dev`).

**4. Point cc-guard at it** — edit `~/.claude/channels/cc-guard/config.json`:

```json
{
  "network": {
    "ip_lookup_endpoints": [
      "https://whatismyip.yourname.workers.dev"
    ]
  }
}
```

Save — the daemon hot-reloads. cc-guard will now use only your endpoint.

## Why this works

- Cloudflare sees every request anyway; your Worker just reads what CF already
  tells it. No extra data leaves your network.
- CF's free tier (100k requests/day) is far more than cc-guard's actual usage
  (typically < 100 lookups/day).
- ASN classification requires ipinfo.io access; if you need that, keep
  ipinfo.io in the endpoint list alongside your CF Worker — cc-guard
  votes on the IP result but falls back to ipinfo.io for ASN/country.

## Alternative: tiny nginx endpoint

On any VPS:

```nginx
location = /myip {
  default_type application/json;
  return 200 '{"ip":"$remote_addr"}';
}
```

Same idea. Point `ip_lookup_endpoints` at it.
