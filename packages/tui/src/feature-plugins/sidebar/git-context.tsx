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

export function reduceFetchSettled(
  isCurrent: boolean,
  error: unknown,
  data: VcsBranchSummary | undefined,
  prevSummary: VcsBranchSummary | undefined,
): { stale: boolean; summary: VcsBranchSummary | undefined } | null {
  if (!isCurrent) return null
  if (error) return { stale: true, summary: prevSummary }
  return { stale: false, summary: data }
}

function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const [loading, setLoading] = createSignal(true)
  const [stale, setStale] = createSignal(false)
  const [summary, setSummary] = createSignal<VcsBranchSummary>()
  const env = createMemo(() => sidebarLaunchEnv())
  const selectedRef = createMemo(() => props.api.kv.get<string | undefined>(kvRefKey, undefined))
  let reqId = 0

  const refresh = () => {
    const current = selectedRef()
    if (!props.api.kv.ready) return
    const thisReq = ++reqId
    setLoading(true)
    void props.api.client.vcs
      .summary({ ref: current })
      .then((result) => {
        const next = reduceFetchSettled(thisReq === reqId, undefined, result.data, summary())
        if (!next) return
        setSummary(next.summary)
        setStale(next.stale)
      })
      .catch((error) => {
        console.debug("[git-context] vcs.summary failed", error)
        const next = reduceFetchSettled(thisReq === reqId, error, undefined, summary())
        if (!next) return
        setSummary(next.summary)
        setStale(next.stale)
      })
      .finally(() => {
        if (thisReq === reqId) setLoading(false)
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
              <text>
                <span style={{ fg: theme().textMuted }}>{item.key}: </span>
                <span style={{ fg: theme().info }}>{item.value}</span>
              </text>
            )}
          </For>
        </box>
      </Show>
      <Show when={loading() && !summary()}>
        <text fg={theme().textMuted}>Loading git context...</text>
      </Show>
      <Show when={summary()}>
        <Switch>
          <Match when={!activeBranch() || !effectiveRef()}>
            <text fg={theme().textMuted}>Git context unavailable</text>
          </Match>
          <Match when={activeBranch() && effectiveRef()}>
            <box>
              <text fg={theme().text}>
                <b>Git Context</b>
              </text>
              <Show when={stale()}>
                <text fg={theme().warning}>[stale]</text>
              </Show>
              <text>
                <span style={{ fg: theme().textMuted }}>Active: </span>
                <span style={{ fg: theme().success }}>{activeBranch()}</span>
              </text>
              <box flexDirection="row" gap={1}>
                <text>
                  <span style={{ fg: theme().textMuted }}>Reference: </span>
                  <span style={{ fg: theme().info }}>{effectiveRef()}</span>
                </text>
                <Show when={availableRefs().length > 0}>
                  <text fg={theme().warning} onMouseDown={openRefSelector}>[change]</text>
                </Show>
              </box>
              <text>
                <span style={{ fg: theme().textMuted }}>Commits: </span>
                <span style={{ fg: theme().text }}>{summary()!.commit_rows.length}</span>
                <span style={{ fg: theme().textMuted }}>/</span>
                <span style={{ fg: theme().info }}>{summary()!.commit_total}</span>
              </text>
              <For each={summary()!.commit_rows}>
                {(item) => (
                  <text>
                    <span style={{ fg: theme().warning }}>{item.hash.slice(0, 7)}</span>
                    <span style={{ fg: theme().textMuted }}> </span>
                    <span style={{ fg: theme().textMuted }}>{item.subject}</span>
                  </text>
                )}
              </For>
              <text>
                <span style={{ fg: theme().textMuted }}>Diff: </span>
                <span style={{ fg: theme().diffAdded }}>+{summary()!.diff.additions}</span>
                <span style={{ fg: theme().textMuted }}> </span>
                <span style={{ fg: theme().diffRemoved }}>-{summary()!.diff.deletions}</span>
                <span style={{ fg: theme().textMuted }}> (</span>
                <span style={{ fg: theme().text }}>{summary()!.diff.rows.length}</span>
                <span style={{ fg: theme().textMuted }}>/</span>
                <span style={{ fg: theme().info }}>{summary()!.diff.total_files}</span>
                <span style={{ fg: theme().textMuted }}> files)</span>
              </text>
              <For each={summary()!.diff.rows}>
                {(item) => (
                  <text>
                    <span style={{ fg: theme().textMuted }}>{item.file}</span>
                    <span style={{ fg: theme().textMuted }}> </span>
                    <span style={{ fg: theme().diffAdded }}>+{item.additions}</span>
                    <span style={{ fg: theme().textMuted }}> </span>
                    <span style={{ fg: theme().diffRemoved }}>-{item.deletions}</span>
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
