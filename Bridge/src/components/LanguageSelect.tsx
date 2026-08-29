import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
} from 'react'
import {
  AUTO_SOURCE_LANGUAGE,
  supportedLanguages,
  type SourceLanguageCode,
} from '../types'
import { languageColor, nativeLanguageName } from '../languageDisplay'
import './LanguageSelect.css'

type Props = {
  /** Short caption above the value, e.g. "From". */
  label: string
  value: SourceLanguageCode
  /** Whether per-utterance automatic detection is offered as an option. */
  allowAuto?: boolean
  onChange: (code: SourceLanguageCode) => void
  buttonRef?: Ref<HTMLButtonElement>
}

type Option = {
  code: string
  label: string
  /** Native name, or the auto option's short description. */
  detail: string | null
  /** Accent color; `null` for Auto-detect. */
  color: string | null
  /** Script the detail is written in, for correct rendering. */
  detailLang?: string
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`language-chevron${open ? ' chevron-open' : ''}`}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m4 6 4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function AutoGlyph() {
  return (
    <svg
      className="language-auto-glyph"
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M8 1.5 9.4 5.6l4.1 1.4-4.1 1.4L8 12.5 6.6 8.4 2.5 7l4.1-1.4L8 1.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="m12.7 10.8.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6.6-1.7Z"
        fill="currentColor"
      />
    </svg>
  )
}

function CheckGlyph() {
  return (
    <svg
      className="language-check"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m3.5 8.5 3 3 6-7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * A language picker in the shape of a listbox button: the trigger shows the
 * language's accent, English label, and native name; the menu lists every
 * supported language the same way. Focus never leaves the trigger — arrow
 * keys move `aria-activedescendant` — so the control behaves like the native
 * select it replaces.
 */
export function LanguageSelect({
  label,
  value,
  allowAuto = false,
  onChange,
  buttonRef,
}: Props) {
  const reactId = useId()
  const labelId = `${reactId}-label`
  const valueId = `${reactId}-value`
  const optionId = (index: number) => `${reactId}-option-${index}`

  const options = useMemo<Option[]>(() => {
    const languages: Option[] = supportedLanguages.map((language) => ({
      code: language.code,
      label: language.label,
      detail: nativeLanguageName(language.code),
      color: languageColor(language.code),
      detailLang: language.code,
    }))
    if (!allowAuto) return languages
    return [
      {
        code: AUTO_SOURCE_LANGUAGE,
        label: 'Auto-detect',
        detail: 'Detect each speaker’s language',
        color: null,
      },
      ...languages,
    ]
  }, [allowAuto])

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.code === value),
  )
  const selected = options[selectedIndex]

  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(selectedIndex)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)
  const typeaheadRef = useRef('')
  const typeaheadTimerRef = useRef<number | undefined>(undefined)

  function openMenu(index = selectedIndex) {
    setActiveIndex(index)
    setOpen(true)
  }

  function selectOption(index: number) {
    const option = options[index]
    if (!option) return
    if (option.code !== value) onChange(option.code as SourceLanguageCode)
    setOpen(false)
  }

  // Close when the pointer lands anywhere outside the control.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // Keep the highlighted option visible while roaming a long list.
  useEffect(() => {
    if (!open) return
    menuRef.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  useEffect(() => {
    return () => window.clearTimeout(typeaheadTimerRef.current)
  }, [])

  /** Typeahead: match the label or native name, cycling past the current row. */
  function findOption(char: string, fromIndex: number): number {
    let query = (typeaheadRef.current + char).toLowerCase()
    // Repeating one character hops between its matches instead of narrowing.
    if (query.length > 1 && new Set(query).size === 1) query = char
    typeaheadRef.current = query
    window.clearTimeout(typeaheadTimerRef.current)
    typeaheadTimerRef.current = window.setTimeout(() => {
      typeaheadRef.current = ''
    }, 700)

    for (let step = 1; step <= options.length; step += 1) {
      const index = (fromIndex + step) % options.length
      const option = options[index]
      if (
        option.label.toLowerCase().startsWith(query) ||
        option.detail?.toLowerCase().startsWith(query)
      ) {
        return index
      }
    }
    return -1
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const { key } = event
    const handled = () => {
      event.preventDefault()
      event.stopPropagation()
    }
    const isPrintable =
      key.length === 1 && /\S/.test(key) && !event.metaKey && !event.ctrlKey && !event.altKey

    if (!open) {
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
        handled()
        openMenu()
      } else if (isPrintable) {
        const match = findOption(key, selectedIndex)
        if (match >= 0) {
          handled()
          openMenu(match)
        }
      }
      return
    }

    switch (key) {
      case 'ArrowDown':
        handled()
        setActiveIndex((index) => (index + 1) % options.length)
        break
      case 'ArrowUp':
        handled()
        setActiveIndex((index) => (index - 1 + options.length) % options.length)
        break
      case 'Home':
        handled()
        setActiveIndex(0)
        break
      case 'End':
        handled()
        setActiveIndex(options.length - 1)
        break
      case 'ArrowLeft':
      case 'ArrowRight':
        // The menu owns every arrow while open; left/right simply do nothing.
        handled()
        break
      case 'Enter':
      case ' ':
        handled()
        selectOption(activeIndex)
        break
      case 'Escape':
        handled()
        setOpen(false)
        break
      case 'Tab':
        setOpen(false)
        break
      default:
        if (isPrintable) {
          const match = findOption(key, activeIndex)
          if (match >= 0) setActiveIndex(match)
        }
    }
  }

  return (
    <div className="language-select" ref={rootRef}>
      <button
        type="button"
        className="language-trigger"
        ref={buttonRef}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${labelId} ${valueId}`}
        aria-activedescendant={open ? optionId(activeIndex) : undefined}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleKeyDown}
      >
        <span className="language-trigger-text">
          <span className="language-trigger-label" id={labelId}>
            {label}
          </span>
          <span className="language-trigger-value" id={valueId}>
            {selected.color ? (
              <span
                className="language-dot"
                style={{ background: selected.color }}
                aria-hidden="true"
              />
            ) : (
              <AutoGlyph />
            )}
            <span className="language-name">{selected.label}</span>
            {selected.color && selected.detail ? (
              <span className="language-native" lang={selected.detailLang}>
                {selected.detail}
              </span>
            ) : null}
          </span>
        </span>
        <Chevron open={open} />
      </button>

      {open ? (
        <ul
          className="language-menu"
          role="listbox"
          aria-labelledby={labelId}
          ref={menuRef}
        >
          {options.map((option, index) => (
            <li
              key={option.code}
              id={optionId(index)}
              role="option"
              aria-selected={option.code === value}
              className={[
                'language-option',
                index === activeIndex ? 'option-active' : '',
                option.code === value ? 'option-selected' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onMouseEnter={() => setActiveIndex(index)}
              // Focus stays on the trigger; the press selects on click.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectOption(index)}
            >
              {option.color ? (
                <span
                  className="language-dot"
                  style={{ background: option.color }}
                  aria-hidden="true"
                />
              ) : (
                <AutoGlyph />
              )}
              <span className="option-text">
                <span className="option-label">{option.label}</span>
                {option.detail ? (
                  <span className="option-native" lang={option.detailLang}>
                    {option.detail}
                  </span>
                ) : null}
              </span>
              {option.code === value ? <CheckGlyph /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
