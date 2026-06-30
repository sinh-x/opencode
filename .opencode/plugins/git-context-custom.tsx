/** @jsxImportSource @opentui/solid */
import type { TuiDialogSelectOption, TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { VcsBranchSummary } from "@opencode-ai/sdk/v2"
import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"

const kvRefGlobalKey = "sidebar_git_selected_ref"
const refreshPollMs = 10_000
const maxCommitRows = 5
const maxDiffRows = 8

function selectedRefKey(worktree: string | undefined, directory: string | undefined, cwd: string = process.cwd()) {
  const scope = worktree || directory || cwd
  return `${kvRefGlobalKey}:${scope}`
}

function storedSelectedRef(repoValue: string | null, legacyValue: string | null) {
  if (repoValue) return repoValue
  return legacyValue ?? undefined
}

function effectiveSelectedRef(summary: VcsBranchSummary | undefined, stored: string | undefined) {
  if (!summary) return
  if (stored && summary.available_refs.includes(stored)) return stored
  return summary.selected_ref
}

function refreshState(previousSummary: VcsBranchSummary | undefined, nextSummary: VcsBranchSummary | undefined, failed: boolean) {
  if (failed) return { summary: previousSummary, stale: Boolean(previousSummary) }
  return { summary: nextSummary, stale: false }
}

function refOptions(refs: string[]): TuiDialogSelectOption<string>[] {
  return refs.map((item) => ({
    title: item,
    value: item,
    category: item.startsWith("origin/") ? "Remote" : "Local",
  }))
}

function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const [loading, setLoading] = createSignal(true)
  const [summary, setSummary] = createSignal<VcsBranchSummary>()
  const [stale, setStale] = createSignal(false)
  const [pollTick, setPollTick] = createSignal(0)
  const branchFromState = createMemo(() => props.api.state.vcs?.branch)
  const selectedRefKeyMemo = createMemo(() =>
    selectedRefKey(props.api.state.path.worktree, props.api.state.path.directory),
  )
  const selectedRef = createMemo(() =>
    storedSelectedRef(
      props.api.kv.get<string | null>(selectedRefKeyMemo(), null),
      props.api.kv.get<string | null>(kvRefGlobalKey, null),
    ),
  )

  createEffect(() => {
    const timer = setInterval(() => setPollTick((value) => value + 1), refreshPollMs)
    onCleanup(() => clearInterval(timer))
  })

  createEffect(() => {
    const branch = branchFromState()
    void pollTick()
    void selectedRef()
    void selectedRefKeyMemo()
    if (typeof props.api.client.vcs?.summary !== "function") {
      setLoading(false)
      return
    }
    const ref = selectedRef() ?? branch
    setLoading(true)
    props.api.client.vcs
      .summary({ ref })
      .then((result) => {
        const next = refreshState(summary(), result.data, false)
        setSummary(next.summary)
        setStale(next.stale)
      })
      .catch(() => {
        const next = refreshState(summary(), undefined, true)
        setSummary(next.summary)
        setStale(next.stale)
      })
      .finally(() => setLoading(false))
  })

  const availableRefs = createMemo(() => summary()?.available_refs ?? [])
  const activeBranch = createMemo(() => summary()?.active_branch)
  const effectiveRef = createMemo(() => effectiveSelectedRef(summary(), selectedRef()))
  const commits = createMemo(() => summary()?.commit_rows.slice(0, maxCommitRows) ?? [])
  const diffRows = createMemo(() => summary()?.diff.rows.slice(0, maxDiffRows) ?? [])

  const openRefSelector = () => {
    const options = refOptions(availableRefs())
    if (!options.length) return
    props.api.ui.dialog.replace(() => (
      <props.api.ui.DialogSelect
        title="Git Comparison Ref"
        current={effectiveRef()}
        options={options}
        onSelect={(item) => {
          props.api.kv.set(selectedRefKeyMemo(), item.value)
          props.api.ui.dialog.clear()
        }}
      />
    ))
  }

  return (
    <box flexDirection="column" gap={0}>
      <text fg={theme().text}>
        <b>Git Context (custom)</b>
      </text>
      <Show when={stale()}>
        <text fg={theme().warning}>[stale]</text>
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
            <For each={commits()}>
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
            <For each={diffRows()}>
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
          </Match>
        </Switch>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 360,
    slots: {
      sidebar_content() {
        return <View api={api} />
      },
    },
  })
  api.lifecycle.onDispose(() => {})
}

const plugin = {
  id: "git-context-custom",
  tui,
}

export default plugin