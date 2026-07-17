import type { TuiDialogSelectOption, TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"

const id = "git-context"
const kvRefKey = "sidebar_git_selected_ref"
const envKeys = ["PA_DEPLOYMENT_ID", "PA_MODE", "PA_TEAM", "PA_TICKET_ID", "PA_PROVIDER", "PA_MODEL"] as const
const secretPattern = /(TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL)/i

type VcsBranchSummary = {
  active_branch?: string
  selected_ref?: string
  available_refs: string[]
  commit_total: number
  commit_rows: Array<{ hash: string; subject: string; author: string }>
  diff: {
    total_files: number
    additions: number
    deletions: number
    rows: Array<{ file: string; additions: number; deletions: number }>
  }
}

export function sidebarLaunchEnv(source: NodeJS.ProcessEnv = process.env) {
  return envKeys.flatMap((key) => {
    if (secretPattern.test(key)) return []
    const value = source[key]
    if (!value?.trim()) return []
    return [{ key, value }]
  })
}

export function sidebarSelectedRef(summary: VcsBranchSummary | undefined, stored: string | undefined) {
  if (!summary) return
  if (stored && summary.available_refs.includes(stored)) return stored
  return summary.selected_ref
}

function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const [loading, setLoading] = createSignal(true)
  const [stale, setStale] = createSignal(false)
  const [summary, setSummary] = createSignal<VcsBranchSummary>()
  const env = createMemo(() => sidebarLaunchEnv())
  const selectedRef = createMemo(() => props.api.kv.get<string | undefined>(kvRefKey, undefined))

  const refresh = () => {
    const current = selectedRef()
    props.api.state.vcs?.branch
    if (!props.api.kv.ready) return
    setLoading(true)
    void props.api.client.vcs
      .summary({ ref: current })
      .then((result) => {
        setSummary(result.data)
        setStale(false)
      })
      .catch((error) => {
        console.debug("[git-context] vcs.summary failed", error)
        setStale(true)
      })
      .finally(() => {
        setLoading(false)
      })
  }

  createEffect(() => {
    selectedRef()
    props.api.state.vcs?.branch
    if (!props.api.kv.ready) return
    refresh()
    const timer = setInterval(refresh, 10_000)
    onCleanup(() => clearInterval(timer))
  })

  const availableRefs = createMemo(() => summary()?.available_refs ?? [])
  const activeBranch = createMemo(() => summary()?.active_branch)
  const effectiveRef = createMemo(() => sidebarSelectedRef(summary(), selectedRef()))

  const openRefSelector = () => {
    const options = availableRefs().map(
      (item): TuiDialogSelectOption<string> => ({
        title: item,
        value: item,
        category: item.startsWith("origin/") ? "Remote" : "Local",
      }),
    )
    if (!options.length) return
    props.api.ui.dialog.replace(() => (
      <props.api.ui.DialogSelect
        title="Git Comparison Ref"
        current={effectiveRef()}
        options={options}
        onSelect={(item) => {
          props.api.kv.set(kvRefKey, item.value)
          props.api.ui.dialog.clear()
        }}
      />
    ))
  }

  return (
    <box>
      <Show when={env().length > 0}>
        <box>
          <text fg={theme().text}>
            <b>OPA Context</b>
          </text>
          <For each={env()}>
            {(item) => (
              <text fg={theme().textMuted}>
                {item.key}: {item.value}
              </text>
            )}
          </For>
        </box>
      </Show>
      <Show when={loading() && !summary()}>
        <text fg={theme().textMuted}>Loading git context...</text>
      </Show>
      <Show when={stale() && summary()}>
        <text fg={theme().textMuted}>(stale)</text>
      </Show>
      <Show when={!loading() && summary()}>
        <Switch>
          <Match when={!activeBranch() || !effectiveRef()}>
            <text fg={theme().textMuted}>Git context unavailable</text>
          </Match>
          <Match when={activeBranch() && effectiveRef()}>
            <box>
              <text fg={theme().text}>
                <b>Git Context</b>
              </text>
              <text fg={theme().textMuted}>Active: {activeBranch()}</text>
              <box flexDirection="row" gap={1}>
                <text fg={theme().textMuted}>Reference: {effectiveRef()}</text>
                <Show when={availableRefs().length > 0}>
                  <text fg={theme().text} onMouseDown={openRefSelector}>
                    [change]
                  </text>
                </Show>
              </box>
              <text fg={theme().textMuted}>
                Commits: {summary()!.commit_rows.length}/{summary()!.commit_total}
              </text>
              <For each={summary()!.commit_rows}>
                {(item) => (
                  <text fg={theme().textMuted}>
                    {item.hash.slice(0, 7)} {item.subject}
                  </text>
                )}
              </For>
              <text fg={theme().textMuted}>
                Diff: +{summary()!.diff.additions} -{summary()!.diff.deletions} ({summary()!.diff.rows.length}/
                {summary()!.diff.total_files} files)
              </text>
              <For each={summary()!.diff.rows}>
                {(item) => (
                  <text fg={theme().textMuted}>
                    {item.file} +{item.additions} -{item.deletions}
                  </text>
                )}
              </For>
            </box>
          </Match>
        </Switch>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 350,
    slots: {
      sidebar_content() {
        return <View api={api} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
