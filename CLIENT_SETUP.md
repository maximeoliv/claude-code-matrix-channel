# Setup côté ton client Claude Code (Shadow / Mac / Linux / Windows)

Ce MCP server tourne sur **panels** (où Synapse est). Ton Claude Code local le pilote
via `tailscale ssh` — donc rien à installer côté client à part `tailscale` (déjà là).

## 1. Ajouter le MCP à ton `~/.claude.json`

Édite `~/.claude.json` (ou `%USERPROFILE%\.claude.json` sur Windows) et ajoute la
section `mcpServers` :

```json
{
  "mcpServers": {
    "matrix-channel": {
      "command": "tailscale",
      "args": [
        "ssh",
        "root@panels.tail91a2f7.ts.net",
        "node",
        "/root/matrix-channel/dist/index.js"
      ]
    }
  }
}
```

S'il y a déjà un `mcpServers` existant, ajoute juste l'entrée `"matrix-channel"`
à l'intérieur.

## 2. Activer le channel au démarrage de Claude Code

Le flag pour les channels custom (research preview) :

```bash
claude --dangerously-load-development-channels server:matrix-channel
```

Tu peux mettre ça dans un alias :

```bash
# .zshrc / .bashrc
alias cc='claude --dangerously-load-development-channels server:matrix-channel'
```

## 3. Tester

1. Lance `cc` (ou `claude --dangerously-load-development-channels server:matrix-channel`)
2. Dans Element, écris dans **n'importe quelle room** où le bot
   `@claude-code-panels` est présent (par défaut: `#claude-code-panels-main`).
3. Dans ta session Claude Code, tu devrais voir la balise `<channel>` apparaître
   comme un nouvel input :

   ```
   <channel source="matrix" sender="@maximusprime:..." room_id="!OpbN...">
   ton message ici
   </channel>
   ```

4. Réponds normalement. Claude utilisera le tool `reply` (du MCP) avec le bon
   `room_id` → ta réponse arrive dans Element.

## 4. Sécurité (allowlist)

Côté panels, dans `/root/matrix-channel/.env` :

```bash
ALLOWED_SENDERS=@maximusprime:panels.tail91a2f7.ts.net
ALLOWED_ROOMS=    # vide = toutes les rooms autorisées (si sender OK)
```

Seul `@maximusprime` peut pousser des messages. Tout autre sender est ignoré
(droppé silencieusement, log côté server).

## 5. Si tu veux relayer les approvals (Bash, Edit, etc.)

Mets `ADMIN_ROOM_ID` dans le `.env` pour qu'à chaque demande de permission,
un message arrive dans cette room :

```bash
ADMIN_ROOM_ID=!OpbNrMjguntVCQBhQG:panels.tail91a2f7.ts.net  # exemple : panels-main
```

Tu réponds `yes <id>` ou `no <id>` dans la room → la décision arrive à Claude.

## Logs côté server

```bash
tailscale ssh root@panels.tail91a2f7.ts.net 'tail -F /root/matrix-channel/matrix-channel.log'
```

## Si ça ne marche pas

1. Vérifie que le service `claude-code-matrix.service` est bien **stoppé** sur
   panels (sinon les deux consomment le même `@claude-code-panels` et se
   marchent dessus) :
   ```bash
   tailscale ssh root@panels.tail91a2f7.ts.net 'systemctl status claude-code-matrix'
   ```
2. Vérifie que `tailscale ssh root@panels.tail91a2f7.ts.net 'echo ok'` marche
   depuis ton client (sans password prompt).
3. Lance Claude Code avec `--debug` pour voir si le MCP est chargé.
