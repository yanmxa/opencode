import { render, useKeyboard, useTerminalDimensions, useRenderer } from "@opentui/solid"
import { TextAttributes, RGBA, ScrollBoxRenderable } from "@opentui/core"
import { createSignal, createMemo, createEffect, For, Show } from "solid-js"
import * as fuzzysort from "fuzzysort"
import { Locale } from "@/util/locale"
import { Session } from "@/session"
import path from "path"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"

interface SessionOption {
  id: string
  title: string
  displayTitle: string
  timeAgo: string
  messageCount: number
  directory: string
}

interface SessionPickerProps {
  sessions: SessionOption[]
  onSelect: (sessionId: string) => void
  onCancel: () => void
  mode: "dark" | "light"
}

// Theme colors based on mode
function getTheme(mode: "dark" | "light") {
  if (mode === "light") {
    return {
      primary: RGBA.fromHex("#ea580c"),
      text: RGBA.fromHex("#171717"),
      textMuted: RGBA.fromHex("#737373"),
      textDim: RGBA.fromHex("#a3a3a3"),
      background: RGBA.fromHex("#ffffff"),
      accent: RGBA.fromHex("#16a34a"),
    }
  }
  return {
    primary: RGBA.fromHex("#f97316"),
    text: RGBA.fromHex("#f5f5f5"),
    textMuted: RGBA.fromHex("#737373"),
    textDim: RGBA.fromHex("#525252"),
    background: RGBA.fromHex("#0a0a0a"),
    accent: RGBA.fromHex("#22c55e"),
  }
}

function SessionPicker(props: SessionPickerProps) {
  const [filter, setFilter] = createSignal("")
  const [selected, setSelected] = createSignal(0)
  let scroll: ScrollBoxRenderable | undefined
  let inputRef: any

  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const theme = getTheme(props.mode)

  const handleSelect = (sessionId: string) => {
    renderer.destroy()
    props.onSelect(sessionId)
  }

  const handleCancel = () => {
    renderer.destroy()
    props.onCancel()
  }

  // Fuzzy filter sessions
  const filtered = createMemo(() => {
    const query = filter().toLowerCase()
    if (!query) {
      return props.sessions
    }
    const results = fuzzysort.go(query, props.sessions, {
      keys: ["displayTitle", "directory"],
      threshold: -10000,
    })
    return results.map((r) => r.obj)
  })

  // Reset selection when filter changes
  createEffect(() => {
    filter() // track
    setSelected(0)
    scroll?.scrollTo(0)
  })

  // Move selection
  function move(direction: number) {
    const items = filtered()
    if (items.length === 0) return
    let next = selected() + direction
    if (next < 0) next = items.length - 1
    if (next >= items.length) next = 0
    setSelected(next)

    // Scroll into view
    if (scroll) {
      const itemHeight = 3 // each item is ~3 lines
      const visibleHeight = Math.floor(dimensions().height / 2) - 4
      const scrollY = scroll.y ?? 0

      if (next * itemHeight >= scrollY + visibleHeight) {
        scroll.scrollTo(next * itemHeight - visibleHeight + itemHeight)
      } else if (next * itemHeight < scrollY) {
        scroll.scrollTo(next * itemHeight)
      }
    }
  }

  // Handle keyboard
  useKeyboard((evt) => {
    // Navigation
    if (evt.name === "up" || (evt.name === "k" && !evt.ctrl)) {
      if (filter().length === 0 || evt.name === "up") {
        move(-1)
        if (evt.name === "up") evt.preventDefault()
      }
    }
    if (evt.name === "down" || (evt.name === "j" && !evt.ctrl)) {
      if (filter().length === 0 || evt.name === "down") {
        move(1)
        if (evt.name === "down") evt.preventDefault()
      }
    }

    // Vim-style navigation when filter is empty
    if (filter().length === 0) {
      if (evt.name === "j") move(1)
      if (evt.name === "k") move(-1)
    }

    // Selection
    if (evt.name === "return") {
      const items = filtered()
      if (items.length > 0) {
        handleSelect(items[selected()].id)
      }
    }

    // Cancel
    if (evt.name === "escape" || (evt.ctrl && evt.name === "c")) {
      handleCancel()
    }
  })

  const maxHeight = createMemo(() => Math.floor(dimensions().height / 2) - 2)

  return (
    <box flexDirection="column" gap={1}>
      {/* Header */}
      <box paddingLeft={1}>
        <text fg={theme.accent} attributes={TextAttributes.BOLD}>
          Resume Session
        </text>
      </box>

      {/* Search input */}
      <box paddingLeft={1} paddingRight={1} flexDirection="row" gap={1}>
        <text fg={theme.textMuted}>{">"}</text>
        <input
          ref={(r: any) => {
            inputRef = r
            setTimeout(() => r?.focus(), 10)
          }}
          placeholder="Search..."
          onInput={(e) => setFilter(e)}
          focusedTextColor={theme.text}
          cursorColor={theme.primary}
        />
        <text fg={theme.textDim}>[esc to cancel]</text>
      </box>

      {/* Session list */}
      <Show
        when={filtered().length > 0}
        fallback={
          <box paddingLeft={3}>
            <text fg={theme.textMuted}>No sessions found</text>
          </box>
        }
      >
        <scrollbox
          ref={(r: ScrollBoxRenderable) => (scroll = r)}
          maxHeight={maxHeight()}
          scrollbarOptions={{ visible: false }}
        >
          <For each={filtered()}>
            {(session, index) => {
              const isSelected = createMemo(() => index() === selected())
              return (
                <box flexDirection="column" paddingLeft={1} paddingBottom={1}>
                  {/* Title row */}
                  <box flexDirection="row" gap={1}>
                    <text fg={isSelected() ? theme.primary : theme.textMuted}>
                      {isSelected() ? "▸" : " "}
                    </text>
                    <text
                      fg={isSelected() ? theme.text : theme.textMuted}
                      attributes={isSelected() ? TextAttributes.BOLD : undefined}
                    >
                      {Locale.truncate(session.displayTitle, 70)}
                    </text>
                  </box>
                  {/* Metadata row */}
                  <box paddingLeft={3}>
                    <text fg={theme.textDim}>
                      {session.timeAgo} · {session.messageCount} {session.messageCount === 1 ? "message" : "messages"} ·{" "}
                      {session.directory}
                    </text>
                  </box>
                </box>
              )
            }}
          </For>
        </scrollbox>
      </Show>
    </box>
  )
}

/**
 * Show a fzf-style session picker and return the selected session ID
 */
export async function sessionPicker(
  sdk: OpencodeClient,
  mode: "dark" | "light",
): Promise<string | null> {
  // Fetch sessions
  const sessionsResult = await sdk.session.list()
  const sessions = (sessionsResult.data ?? [])
    .filter((s) => !s.parentID)
    .sort((a, b) => b.time.updated - a.time.updated)

  if (sessions.length === 0) {
    return null
  }

  // Fetch message counts and first user messages
  const sessionOptions: SessionOption[] = await Promise.all(
    sessions.slice(0, 50).map(async (session) => {
      // Get messages
      const messagesResult = await sdk.session.messages({ sessionID: session.id, limit: 100 }).catch(() => null)
      const messages = messagesResult?.data ?? []
      const messageCount = messages.length

      // Get display title
      let displayTitle = session.title
      if (Session.isDefaultTitle(session.title)) {
        const firstUserMsg = messages.find((m) => m.info.role === "user")
        if (firstUserMsg) {
          const textPart = firstUserMsg.parts?.find((p: any) => p.type === "text") as { text?: string } | undefined
          if (textPart?.text) {
            displayTitle = textPart.text.slice(0, 100)
          } else {
            displayTitle = "Untitled"
          }
        } else {
          displayTitle = "Untitled"
        }
      }

      return {
        id: session.id,
        title: session.title,
        displayTitle,
        timeAgo: Locale.timeAgo(session.time.updated),
        messageCount,
        directory: path.basename(session.directory),
      }
    }),
  )

  return new Promise<string | null>((resolve) => {
    render(
      () => (
        <SessionPicker
          sessions={sessionOptions}
          mode={mode}
          onSelect={(sessionId) => resolve(sessionId)}
          onCancel={() => resolve(null)}
        />
      ),
      {
        exitOnCtrlC: false,
      },
    )
  })
}
