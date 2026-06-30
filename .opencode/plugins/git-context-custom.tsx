/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { VcsBranchSummary } from "@opencode-ai/sdk/v2"
import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"

const refreshPollMs = 10_000
const maxCommitRows = 5
const maxDiffRows = 8

function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const [loading, setLoading] = createSignal(true)
  const [summary, setSummary] = createSignal<VcsBranchSummary>()
  const [stale, setStale] = createSignal(false)
  const [pollTick, setPollTick] = createSignal(0)
  const branchFromState = createMemo(() => props.api.state.vcs?.branch)

  createEffect(() => {
    const timer = setInterval(() => setPollTick((value) => value + 1), refreshPollMs)
    onCleanup(() => clearInterval(timer))
  })

  createEffect(() => {
    const branch = branchFromState()
    void pollTick()
    if (typeof props.api.client.vcs?.summary !== "function") {
      setLoading(false)
      return
    }
    setLoading(true)
    props.api.client.vcs
      .summary({ ref: branch })
      .then((result) => {
        setSummary(result.data)
        setStale(false)
      })
      .catch(() => {
        setStale(Boolean(summary()))
      })
      .finally(() => setLoading(false))
  })

  const activeBranch = createMemo(() => summary()?.active_branch ?? branchFromState())
  const commits = createMemo(() => summary()?.commit_rows.slice(0, maxCommitRows) ?? [])
  const diffRows = createMemo(() => summary()?.diff.rows.slice(0, maxDiffRows) ?? [])

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
          <Match when={!activeBranch()}>
            <text fg={theme().textMuted}>Git context unavailable</text>
          </Match>
          <Match when={activeBranch()}>
            <text>
              <span style={{ fg: theme().textMuted }}>Active: </span>
              <span style={{ fg: theme().success }}>{activeBranch()}</span>
            </text>
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