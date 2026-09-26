import { presetAction, rebuildIndexAction, saveSettingsAction } from "../actions";
import { Messages } from "../components/Messages";
import { SubmitButton } from "../components/SubmitButton";
import { checkModels, sendsMaterialOut } from "@/lib/model";
import { loadPageData } from "@/lib/pageData";
import { homePaths } from "@/lib/paths";
import { indexModel, openIndex } from "@/lib/search";
import { readSettings } from "@/lib/settings";

/** Always rendered fresh from the logs, never cached. */
export const dynamic = "force-dynamic";

/**
 * Model settings, the model check, and rebuilding the search file.
 *
 * @openapi
 * GET /settings:
 *   summary: Settings
 *   parameters:
 *     - name: note
 *       in: query
 *       required: false
 *       description: >-
 *         The id of a message a form action left for this page, such as "Settings saved." or an
 *         error. Only ids this running Kizuki made show anything; any other value is ignored.
 *       schema: { type: string }
 *   responses:
 *     "200":
 *       description: The page.
 *       content:
 *         text/html:
 *           schema: { type: string }
 *     "500":
 *       description: >-
 *         Kizuki could not read your data, for example because a log line is broken. The page
 *         shows "Something went wrong"; the full message, with the file and line, is printed
 *         where Kizuki runs.
 */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ note?: string }> }) {
  const messages = await searchParams;
  const data = await loadPageData();
  const settings = await readSettings(data.home);
  const check = await checkModels(settings);
  const db = openIndex(homePaths(data.home).index);
  const indexed = (db.prepare("select count(*) as n from passages").get() as { n: number }).n;
  const builtWith = indexModel(db);
  db.close();

  return (
    <>
      <Messages {...messages} />
      <h1>Settings</h1>

      <h2>Your data</h2>
      <p>
        Everything is stored in <code>{data.home}</code>: copies of your files, the logs of what you did, and the search file. Nothing is
        stored anywhere else. To use another folder, start Kizuki with <code>kizuki --home /path/to/folder</code>.
      </p>

      <h2>Models</h2>
      {check.ok ? (
        <div className="notice good">Both models are reachable.</div>
      ) : (
        <div className="notice error">
          <ul>
            {check.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {sendsMaterialOut(settings) ? (
        <div className="notice error">These settings send your material off this computer to a hosted model. Everything else stays local.</div>
      ) : null}
      <div className="row">
        <span className="muted small">Ready-made settings:</span>
        <form action={presetAction.bind(null, "ollama")}>
          <SubmitButton className="secondary">Ollama (default)</SubmitButton>
        </form>
        <form action={presetAction.bind(null, "mlx")}>
          <SubmitButton className="secondary">MLX on Apple chips</SubmitButton>
        </form>
        <form action={presetAction.bind(null, "hosted")} className="row">
          <label className="check small">
            <input type="checkbox" name="sendOut" value="yes" required /> I understand this sends my material to OpenAI
          </label>
          <SubmitButton className="secondary">Hosted model</SubmitButton>
        </form>
      </div>
      <form action={saveSettingsAction} className="card stack">
        {sendsMaterialOut(settings) ? <input type="hidden" name="sendOut" value="yes" /> : null}
        <h3>Answer model</h3>
        <p className="muted small">Proposes concepts and chooses questions. It only quotes and asks, so a small model is enough. Any server that speaks the OpenAI format works.</p>
        <label>
          Address
          <input type="url" name="chatBaseURL" defaultValue={settings.chat.baseURL} required />
        </label>
        <label>
          Model name
          <input type="text" name="chatModel" defaultValue={settings.chat.model} required />
        </label>
        <label>
          Name of the environment variable holding the API key, ending in _API_KEY (leave empty for Ollama and MLX)
          <input type="text" name="chatApiKeyEnv" defaultValue={settings.chat.apiKeyEnv ?? ""} placeholder="OPENAI_API_KEY" />
        </label>
        <label>
          Thinking
          <select name="reasoning" defaultValue={settings.chat.reasoning}>
            <option value="none">Off (faster on small local models)</option>
            <option value="default">Leave it to the model</option>
          </select>
        </label>
        <label>
          Reply shape
          <select name="replyShape" defaultValue={settings.chat.replyShape}>
            <option value="server">The server keeps replies in shape (Ollama, OpenAI)</option>
            <option value="prompt">Kizuki describes the shape and checks each reply (MLX)</option>
          </select>
        </label>
        <h3>Meaning-search model</h3>
        <p className="muted small">Turns passages into numbers so Kizuki can find them when your words differ from the material's.</p>
        <label>
          Address
          <input type="url" name="embedBaseURL" defaultValue={settings.embed.baseURL} required />
        </label>
        <label>
          Model name
          <input type="text" name="embedModel" defaultValue={settings.embed.model} required />
        </label>
        <label>
          Name of the environment variable holding the API key
          <input type="text" name="embedApiKeyEnv" defaultValue={settings.embed.apiKeyEnv ?? ""} />
        </label>
        <p className="muted small">API keys are read from the environment when needed. They are never saved.</p>
        {sendsMaterialOut(settings) ? null : (
          <label className="check small">
            <input type="checkbox" name="sendOut" value="yes" /> If an address above is not on this computer: I understand this sends my material there
          </label>
        )}
        <SubmitButton pending="Saving…">Save settings</SubmitButton>
      </form>

      <h2>Search file</h2>
      <p>
        {indexed} passages indexed{builtWith ? ` with ${builtWith}` : ""}.{" "}
        {builtWith && builtWith !== settings.embed.model ? <strong>The meaning model changed, so the search file needs a rebuild.</strong> : null}
      </p>
      <form action={rebuildIndexAction}>
        <SubmitButton className="secondary" pending="Rebuilding…">
          Rebuild the search file
        </SubmitButton>
      </form>
    </>
  );
}
