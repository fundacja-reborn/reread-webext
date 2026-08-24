/**
 * The bubble shown next to a selection.
 *
 * It lives in a closed shadow root under one element appended to the page, and
 * that is the whole isolation strategy: the page cannot style it, cannot reach
 * into it, and gets nothing back except one extra child of `<html>`. The host
 * carries no identifying attribute either - an extension is detectable by a
 * determined page anyway, but there is no reason to hand out a selector.
 *
 * Text always goes in through `textContent`. The strings here come from the
 * page being read, and the one thing a bubble must never do is parse them.
 *
 * The bubble knows nothing about the database. It shows what it is given,
 * offers the buttons it is told to offer, and reports which one was pressed -
 * so what "save" means stays in one place, and that place is not here.
 *
 * It does not repeat the phrase it is about. The phrase is on the page, a few
 * pixels away, selected or underlined; printing it again cost a line of the
 * article and gave nothing back. What is left is the gloss and the buttons.
 *
 * The sentence and the dictionary entries, when there are any, are a second
 * layer behind "More" - one line first, everything else on a deliberate second
 * press (G1). They live in their own elements and not in the body, because the
 * body is what gets saved: anything that leaked into it would end up in the
 * vocabulary and on a flashcard.
 *
 * A dictionary line is the one thing down there that is also a button. Pressing
 * it adds that meaning to the body, which is to say to the vocabulary, and
 * pressing it again takes it back out - the bubble still does not know what
 * saving means, it just reports the meanings it is showing the moment they
 * change.
 *
 * Down there the sentence and the dictionary also compete for the same room,
 * and the sentence always won it: it takes the height it takes, and the
 * entries' box is what the squeeze (D79) shortens - on a phone, a long
 * sentence left the dictionary a slot three lines tall. The fold in the
 * sentence's corner is the reader's own say in that split (D96): one press
 * clamps the sentence to a single line, and the next placement hands the
 * freed room to the entries by the same squeeze; pressed again, the sentence
 * comes back. The control stands only where the contest is real - entries
 * below, a sentence long enough to wrap - and every new bubble opens with
 * the sentence whole, because the sentence is what More promises first.
 *
 * Everything in it stands in the order of its distance from the phrase (D44):
 * the gloss on the nearest edge, the actions behind it, the second layer
 * farthest - and the whole column mirrors when the bubble stands above the
 * phrase. The near edge belongs to the gloss because that edge is the
 * eye's way back to the line being read, and what should lie on the way back
 * is the answer, not a row of buttons. On a touch screen the same rule earns
 * its keep twice: actions on the far edge are also actions away from the
 * selection handles and from the browser's own bar, both of which crowd the
 * phrase. An error bubble steps outside the order, because it has no answer
 * to lay on the near edge: what lies there instead is its one real button -
 * the way to the settings - which therefore stays under the text whichever
 * way the bubble grows. It is also the one bubble that signs itself: an error
 * may be the first thing this extension ever shows somebody, and an unsigned
 * complaint floating over a page reads as the page's own - so a small re/read
 * line stands at its top.
 *
 * Two things on a phone's screen are bigger than the bubble and answer to
 * nobody, and D97 is its manners around both. The software keyboard takes the
 * bottom of the screen the moment the edit box is focused, and announces
 * itself only as the visual viewport shrinking - so for exactly as long as
 * the box is open, the bubble watches that viewport and keeps the box and
 * its Save above the keyboard's edge: the reader page scrolls there (bubble
 * and phrase ride the same document, so they arrive together), every other
 * page moves the bubble itself. And a second layer taller than the room
 * beside the phrase used to end with the bubble covering the very phrase it
 * is about; on the reader page it now stands below the phrase and scrolls
 * the page the rest of the way, so the phrase - or at least its first line,
 * when it is long - is on the screen saying what the bubble answers.
 *
 * The reader's page has a third such thing: its own bar, stuck over the top
 * of the text (D93). D138 teaches every move above where that bar ends - the
 * caller hands in `covered`, a live measure of how far down it reaches - so
 * the room to place in starts under the bar and the scroll assist parks the
 * kept line just below it, not beneath it. And a page moved to make room is
 * moved back when the bubble leaves: what the assist and the keyboard
 * reveals scrolled is the bubble's own doing, and hide undoes it - unless
 * the reader scrolled meanwhile, which is their word on where they want to
 * be and outranks the tidying.
 *
 * It comes in two variants, and they were one column told apart by nothing but
 * its starting state (D44): a phrase already kept is a question - what was this
 * again - so `recall` opened folded to one line, while a fresh selection had
 * what to do with it as the whole reason the bubble was open, and `save`
 * opened with the row already out.
 *
 * Since D131 that starting state is the reader's, not the variant's: the
 * quiet-bubble setting (D81) says whether a row waits to be asked for, and it
 * says it about every bubble - the caller passes it, and a bubble told nothing
 * opens with its row out. The fold itself is unchanged; what changed is who
 * decides it. What no setting may hide is a Save or an error's one button:
 * `reveal()` brings the row out when one of them turns out to be the point.
 */

import { MEANING_SEPARATOR, afterChoosing, toMeanings } from "../lib/gloss.js";
import { t } from "../lib/i18n.js";

const GAP = 8;
const VIEWPORT_MARGIN = 8;
/**
 * The gap between the phrase and the bubble when the selection was made by
 * touch, on whichever side the bubble stands. The strip beside a touch
 * selection belongs to the system: its floating bar (Copy/Search) hovers
 * over the phrase, its drag handles hang under the last line - all browser
 * chrome, unmeasurable and unmovable from a page - and a bubble standing at
 * `GAP` lands on one or the other. One strip's width steps past both; the
 * number is an estimate to be tuned on a device, not a fact.
 */
const SYSTEM_GAP = 64;
/**
 * The least the second layer may be squeezed to before the bubble gives up
 * and covers things (see `place`): below this a dictionary entry stops being
 * readable at all, and a scroll of nothing helps nobody.
 */
const MIN_ENTRIES_HEIGHT = 96;

/**
 * Read when a button is rendered, not when the module loads: this module is
 * also imported by tests that have no catalogue to ask, and a bubble never
 * renders there.
 *
 * @param {Action | CopyChoice | "cancel"} action
 * @returns {string}
 */
function label(action) {
  switch (action) {
    case "save":
      return t("bubble_save");
    case "learned":
      return t("bubble_learned");
    case "edit":
      return t("bubble_edit");
    case "settings":
      return t("bubble_settings");
    case "cancel":
      return t("action_cancel");
    case "more":
      return t("bubble_more");
    case "reader":
      return t("bubble_reader");
    case "library":
      // The name the reading list carries everywhere else - the popup's row,
      // the reader's menu, its own heading. One room, one name.
      return t("reading_list");
    case "speak":
      return t("bubble_speak");
    case "copy":
      return t("bubble_copy");
    case "copy-original":
      return t("bubble_copy_original");
    case "copy-translation":
      return t("bubble_copy_translation");
  }
}

/**
 * The speaker, drawn with DOM calls: the bubble never parses markup, its own
 * included, and a handful of `createElementNS` lines keeps that rule without
 * exceptions. `currentColor` hands the icon the button's text color, so every
 * theme and every opacity state is already handled by the button's own rules.
 *
 * @returns {SVGSVGElement}
 */
function speakerIcon() {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  // Decoration to assistive tech - the button's aria-label carries the words.
  svg.setAttribute("aria-hidden", "true");

  const body = document.createElementNS(NS, "path");
  body.setAttribute("d", "M4 9.5v5h3.2L12 18.6V5.4L7.2 9.5H4z");
  body.setAttribute("fill", "currentColor");
  svg.append(body);

  for (const arc of ["M15 9.2a4.4 4.4 0 0 1 0 5.6", "M17.6 6.8a8 8 0 0 1 0 10.4"]) {
    const wave = document.createElementNS(NS, "path");
    wave.setAttribute("d", arc);
    wave.setAttribute("fill", "none");
    wave.setAttribute("stroke", "currentColor");
    wave.setAttribute("stroke-width", "1.8");
    wave.setAttribute("stroke-linecap", "round");
    svg.append(wave);
  }
  return svg;
}

/**
 * The copy icon, drawn the way the speaker is: DOM calls, `currentColor`, no
 * markup parsed. Two offset sheets - the shape the reader page's highlighter
 * bar already taught (D107), scaled onto the speaker's grid so the two
 * pictures in the row read as one set.
 *
 * @returns {SVGSVGElement}
 */
function copyIcon() {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  // Decoration to assistive tech - the button's aria-label carries the words.
  svg.setAttribute("aria-hidden", "true");

  const front = document.createElementNS(NS, "rect");
  front.setAttribute("x", "8");
  front.setAttribute("y", "8");
  front.setAttribute("width", "11.5");
  front.setAttribute("height", "11.5");
  front.setAttribute("rx", "1.8");
  front.setAttribute("fill", "none");
  front.setAttribute("stroke", "currentColor");
  front.setAttribute("stroke-width", "1.9");
  svg.append(front);

  const back = document.createElementNS(NS, "path");
  back.setAttribute("d", "M16.2 4.9H7a2.1 2.1 0 0 0-2.1 2.1v9.2");
  back.setAttribute("fill", "none");
  back.setAttribute("stroke", "currentColor");
  back.setAttribute("stroke-width", "1.9");
  back.setAttribute("stroke-linecap", "round");
  svg.append(back);

  return svg;
}

/** The one button whose label changes with what it will do. */
function lessLabel() {
  return t("bubble_less");
}

/**
 * The fold's chevron, drawn like the speaker: DOM calls, `currentColor`, no
 * markup parsed. It points up while the sentence stands whole - the press
 * would take its lines away - and the stylesheet mirrors it once clamped.
 *
 * @returns {SVGSVGElement}
 */
function chevronIcon() {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  // Decoration to assistive tech - the button's aria-label carries the words.
  svg.setAttribute("aria-hidden", "true");
  const point = document.createElementNS(NS, "path");
  point.setAttribute("d", "M6 14.5l6-5 6 5");
  point.setAttribute("fill", "none");
  point.setAttribute("stroke", "currentColor");
  point.setAttribute("stroke-width", "2");
  point.setAttribute("stroke-linecap", "round");
  point.setAttribute("stroke-linejoin", "round");
  svg.append(point);
  return svg;
}

/**
 * The fold's name, by what pressing it would do next.
 *
 * @param {boolean} clamped
 * @returns {string}
 */
function foldLabel(clamped) {
  return clamped ? t("bubble_sentence_expand") : t("bubble_sentence_collapse");
}

/**
 * Which of its three states the sentence's fold is in (D96).
 *
 * `absent` while there are no dictionary entries: the fold exists to make
 * room for the dictionary, so with nothing below the sentence it has no
 * business standing there. `reserved` while the sentence fits one line on
 * its own - nothing to press, but the column stays, because a control that
 * popped in and out would rewrap the very sentence whose lines decide its
 * visibility. `shown` is the one state where a press changes anything.
 *
 * The measurements are the caller's business - only a laid-out element knows
 * where its lines broke. Exported for the test that holds the rule.
 *
 * @param {{ entries: boolean, overflows: boolean }} layer
 * @returns {"absent" | "reserved" | "shown"}
 */
export function foldControl({ entries, overflows }) {
  if (!entries) return "absent";
  return overflows ? "shown" : "reserved";
}

/**
 * The touch tier of the bubble's sizes - the variables the base \`.bubble\`
 * rule sets, stepped up for a screen pressed by fingers. One string, spliced
 * into the stylesheet twice: once behind the media query and once behind the
 * attribute the gesture sets (D84), so the two ways of saying "touch" can
 * never drift apart. The em values keep the tier's old pixel geometry at its
 * own type sizes: 0.57em of a 14px button is the 8px of padding the tier
 * always had.
 */
const TOUCH_SIZES = `
    --type-body: 16px;
    --type-second: 15px;
    --type-label: 12px;
    --type-action: 14px;
    --type-cta: 15px;
    --gap-actions: 0.63em;
    --pad-sense: 0.4em 0.53em;
    --pad-action: 0.57em 0.43em;
    --pull-action: -0.43em;
    --pad-cta: 0.53em 1.07em;
    --icon: 1.43em;
`;

/** Exported for the test that holds the size system together, nothing else. */
export const STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; }

  /* The hidden attribute is a rule in the browser's own stylesheet, and any
     rule of ours beats it: one display on .editor was enough to leave an empty
     text box sitting under every translation. */
  [hidden] { display: none !important; }

  .bubble {
    color-scheme: light dark;
    /* Hanging off the host's line (D77): the host is a full-width strip of no
       height pinned by top alone, and which way the bubble hangs off it is
       the data-grow rules below. */
    position: absolute;
    /* A column in the order of distance from the phrase - gloss, actions,
       second layer - which the mirror below reverses whole when the bubble
       stands above the phrase. */
    display: flex;
    flex-direction: column;
    /* Every size the bubble draws its type and its presses at, in two tiers
       (D84): these desktop values, and TOUCH_SIZES above, spliced in below -
       by the media query, or by the data-pointer attribute when the gesture
       that made the selection was a finger or a pen. The attribute exists
       because the media query can be wrong about a device: an Onyx e-ink
       tablet reports a fine primary pointer over its touch screen, and the
       gesture is the ground truth. Lengths that have to grow with the type
       are written in em; the fonts multiply by --bubble-scale, the reader's
       own knob over all of it (D85), which show() sets inline here. */
    --type-body: 14px;
    --type-second: 13px;
    --type-label: 11px;
    --type-action: 12px;
    --type-cta: 13px;
    --gap-actions: 0.43em;
    --pad-sense: 0.15em 0.31em;
    --pad-action: 0.17em 0.33em;
    --pull-action: -0.33em;
    --pad-cta: 0.23em 0.77em;
    --icon: 1.33em;
    /* One strength for every line the bubble draws, past 4.5:1 against its own
       paper. An e-ink panel quantizes the screen to 16 greys and rounds a
       near-white hairline back into it, so a tenth of a black is not a faint
       line there - it is no line at all, which is how the separators went
       missing on a Boox. The pages get two strengths (page.css: separators
       quieter than a control's edge), and the bubble had them too for one
       build - but read on paper the quieter one still looked like a mistake
       beside the louder, so the bubble keeps the one that survives. A solid
       color and not an alpha, because nothing here is laid over the page: the
       bubble's background is painted under its own border, so every line in it
       stands on paper we chose. The dark value is in the query at the bottom. */
    --edge: #6e7583;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: calc(var(--type-body) * var(--bubble-scale, 1));
    line-height: 1.45;
    max-width: min(calc(22rem * var(--bubble-scale, 1)), 90vw);
    padding: 10px 12px;
    border-radius: 10px;
    /* The edge, not the shadow, is what says where the bubble ends: an e-ink
       panel flattens the shadow into nothing, and it has to say so over any
       page's colors - so it holds --edge, the strength page.css gives a
       control's border, and not a hairline's. A third of a black said the
       same thing far too quietly there. */
    border: 1px solid var(--edge);
    background: #ffffff;
    color: #1f2430;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
    overflow-wrap: break-word;
  }

  /* Which way the bubble hangs. Only ever off the host's top-pinned line,
     never off a bottom computed from the viewport's height: Android's
     dynamic toolbar walks bottom-anchored fixed elements up and down with
     itself, and a bubble pinned that way landed on its own phrase (D77). */
  .bubble[data-grow="down"] { top: 0; }
  .bubble[data-grow="up"] { bottom: 0; }

  /* A flex item does not shrink below its own content unless it is told to, and
     one long word in a gloss would push the bubble past its maximum width. */
  .bubble > * { min-width: 0; }

  .body { white-space: pre-wrap; }
  .body[data-tone="pending"] { opacity: 0.6; font-style: italic; }
  .body[data-tone="error"] { color: #a3341f; }
  /* The launcher says nothing in its body - its signature is another element -
     and an empty line would still cost the row of pixels its line-height
     reserves. */
  .body:empty { display: none; }

  /* Quieter than the gloss and fenced off from the rest: this is the sentence
     the phrase was in, not another meaning of it. Style and colour go on every
     edge but width on one, so that the mirror below can move the line to the
     other side by widths alone and the colour stays one rule per theme.
     Inside, two columns (D96): the text gives way, the fold in the corner
     keeps its size - and the section's own inside never reorders, whichever
     way the mirror runs the bubble. */
  .context {
    display: flex;
    align-items: flex-start;
    gap: 0.5em;
    margin-top: 8px;
    padding-top: 8px;
    border: 0 solid var(--edge);
    border-top-width: 1px;
    font-size: calc(var(--type-second) * var(--bubble-scale, 1));
    opacity: 0.85;
  }
  .context-text {
    flex: 1;
    min-width: 0;
  }

  /* The same tones the body knows, for the one bubble that fetches its second
     layer on demand: a recalled phrase answers from the database, and the
     sentence starts being translated only when More asks for it. A note is
     the fetch coming back empty-handed - said in the pending line's quiet
     voice, because both are the layer talking about itself, not a sentence. */
  .context[data-tone="pending"],
  .context[data-tone="note"] { opacity: 0.6; font-style: italic; }
  .context[data-tone="error"] { color: #a3341f; }

  /* The clamp the fold buys (D96): one line, cut honestly with an ellipsis.
     The room it frees reaches the dictionary box through the next placement -
     the squeeze (D79) starts from scratch every time - not through anything
     written here. */
  .context[data-folded="true"] .context-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* The fold itself, dressed as a control on purpose: the triangle under the
     dictionary list is a passive mark of a cut box, and two identical glyphs
     of which only one answers a press would teach the wrong lesson about the
     other. So this one carries the frame pressable things get here - the
     edge's solid ink, which an e-ink panel can draw - and its chevron turns
     to point at what the press would do. No transition on the turn: a flip
     is one repaint, an animation is a smear on paper. */
  .context-toggle {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin: 0;
    padding: 0.25em;
    font: inherit;
    color: inherit;
    background: none;
    border: 1px solid var(--edge);
    border-radius: 5px;
    opacity: 0.7;
    cursor: pointer;
  }
  .context-toggle:hover { opacity: 1; }
  .context-toggle:focus-visible {
    opacity: 1;
    outline: 1px solid currentColor;
    outline-offset: 0;
  }
  .context-toggle svg {
    width: var(--icon);
    height: var(--icon);
    display: block;
  }
  .context[data-folded="true"] .context-toggle svg { transform: rotate(180deg); }

  /* A dictionary entry can be long, and a bubble that grows past the window is
     a bubble that covers the sentence somebody was reading. It scrolls instead;
     the page underneath keeps the bubble open while it does. */
  .entries {
    margin-top: 8px;
    padding-top: 8px;
    /* The strip the mark below stands in, kept clear of the text whether or
       not the mark is drawn: reserving it only when the list overflows would
       reflow the very list somebody is reading down. */
    padding-right: 0.9em;
    border: 0 solid var(--edge);
    border-top-width: 1px;
    font-size: calc(var(--type-second) * var(--bubble-scale, 1));
    max-height: 40vh;
    overflow-y: auto;
    overscroll-behavior: contain;
    /* Where a bar is drawn at all it is drawn in our ink. It cannot be the
       thing that says the list scrolls, though: Gecko fades its bar out again
       when nothing is moving, and on Android it is not there until a finger
       is (measured on a Boox - the mark below exists because of it). */
    scrollbar-width: thin;
    scrollbar-color: var(--edge) transparent;
  }

  /* A list longer than its box, said twice: the box closes on a line where it
     was cut, and a small triangle stands in the strip at that corner.

     An inset shadow said it first - macOS hides its scrollbars until something
     moves, so an entry running past the bottom read as an entry that ended
     there - but a shadow is the one thing an e-ink panel cannot draw: 16 greys
     turn it into either nothing or a grey smear lying across the very line it
     was meant to help read. The line that replaced it was honest and too
     quiet: on a Boox a cut and a separator are one and the same line, and a
     reader with no bar on the screen can miss that there is anything to
     scroll at all. So the triangle, and it is ink rather than a fade: one
     conic wedge with a hard stop, nothing for a panel to dither.

     What it says is that the box is cut, not that there is more below this
     exact spot - which is why it may stand still while the reader scrolls.
     The list is longer than the box wherever they have got to, and a mark that
     needs a scroll listener to stop lying would repaint an e-ink panel to say
     something the edge already said.

     Both ways the bubble hangs are covered: growing up the mirror has put the
     line here already. The width growing down adds costs the bubble nothing -
     a box that scrolls is a box already capped in height, and box-sizing is
     border-box. */
  .entries[data-more="true"] {
    border-bottom-width: 1px;
    background-image: conic-gradient(from -45deg at 50% 100%, var(--edge) 0 90deg, transparent 0);
    background-size: 0.7em 0.35em;
    background-position: right 0.1em bottom 0.3em;
    background-repeat: no-repeat;
  }

  .entry + .entry { margin-top: 8px; }

  /* Which book this came from, and the word it actually found - the second one
     matters when the reader selected "watches" and the dictionary knows "watch". */
  .entry-label {
    font-size: calc(var(--type-label) * var(--bubble-scale, 1));
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.6;
    /* The border and the padding a meaning below it carries, so the two start
       at the same place on the screen. */
    padding-left: 5px;
  }

  /* A meaning is a line to read first and a choice second, so it keeps the shape
     of the text around it: a stack of things that look like buttons under a word
     reads as a form to fill in. What says it can be pressed is the cursor and
     the tint under it, and what says it was pressed is the mark that stays. */
  .entry-sense {
    display: block;
    width: 100%;
    margin: 0;
    padding: var(--pad-sense);
    font: inherit;
    text-align: left;
    color: inherit;
    background: none;
    border: 1px solid transparent;
    border-radius: 5px;
    white-space: pre-wrap;
    cursor: pointer;
  }
  /* The tint is the cursor's affordance, so it follows only a real mouse:
     under a finger :hover is an emulation, which paints the line a scroll
     happens to be passing through and stays on the last line touched after
     the finger lifts - a mark that reads as a choice nobody made, beside
     marks that are choices (reported from a Pixel). The media query cannot
     draw this line - a Boox answers it wrong (D84) - so the gate is the same
     attribute the gesture sets for the size tiers. A tap loses nothing: its
     feedback is the border that stays, and on an e-ink panel a transient
     wash was one more repaint of the list being scrolled. */
  .bubble:not([data-pointer="coarse"]) .entry-sense[aria-pressed="false"]:hover:not(:disabled) { background: rgba(0, 0, 0, 0.06); }
  /* The mark that stays, and the border is the whole of it where the tint
     cannot be seen: a wash this light is one of the 16 greys an e-ink panel
     rounds back to paper, and which meanings are already in the gloss is not
     something to leave to a wash. */
  .entry-sense[aria-pressed="true"] {
    background: rgba(0, 0, 0, 0.07);
    border-color: var(--edge);
  }
  /* Not faded while the edit box is open, unlike every other disabled button
     here: the entry is still there to be read, it just cannot be chosen for as
     long as the gloss is being typed by hand. */
  .entry-sense:disabled { opacity: 1; cursor: default; }
  /* The quiet bubble's lines are prose, not presses (D121) - the pointer must
     not promise a choice that does not exist. */
  .bubble[data-variant="quiet"] .entry-sense { cursor: default; }

  .editor {
    display: block;
    width: 100%;
    min-width: 16rem;
    margin: 0;
    padding: 4px 6px;
    font: inherit;
    color: inherit;
    background: rgba(0, 0, 0, 0.04);
    border: 1px solid var(--edge);
    border-radius: 6px;
    resize: none;
  }

  /* The row of actions, folded. The fold is a grid row going from zero to one
     fraction - the one way to animate to a height nobody knows in advance - and
     the clipped child below is what makes it read as unfolding rather than as
     text being squeezed. Folded is where every bubble starts; whether it is
     ever seen there is the reader's setting (D81, D131) - with the row asked
     for, the revealed class is on from the first frame (see show) and the fold
     is never seen; without it, the row waits for somebody to come looking. */
  .reveal {
    display: grid;
    grid-template-rows: 0fr;
    opacity: 0;
    transition: grid-template-rows 150ms ease, opacity 150ms ease;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--gap-actions);
    /* The two pixels on the far side are for a focus ring: a folded row is
       clipped, and a ring drawn flush with the edge would be clipped with it. */
    padding: 8px 0 2px;
    min-height: 0;
    overflow: hidden;
  }
  .actions:empty { display: none; }

  /* Three ways in, and the class is the one that keeps it: a row that folded
     itself away again on mouseleave would flicker at every brush of the
     bubble's edge, and nothing is gained by taking back an answer somebody has
     just gone looking for. The bubble closes in one piece soon enough.

     No branch for touch screens, and that is deliberate (D44): a finger arrives
     by pressing, and the press adds the same class every other way in ends at.
     A media query on hover bought nothing anyway - a hybrid reports hover:hover
     and would have kept the folding, while its taps emulate :hover and unfold
     it - so one rule for every device is also the only consistent one. */
  .bubble:hover .reveal,
  .bubble:focus-within .reveal,
  .bubble.revealed .reveal {
    grid-template-rows: 1fr;
    opacity: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    .reveal { transition: none; }
  }

  /* The mirror (D44). The edge nearest the phrase is pinned (see placement),
     and the gloss has to be the thing lying on it, so everything that appears
     or grows - the row unfolding, the second layer opening behind "More" -
     lands on the far side of the gloss and moves only the edge away from the
     line being read. One rule reverses the whole column, which is what keeps
     the two variants one layout: the same file of elements, read from the
     phrase outwards. */
  .bubble[data-grow="up"] { flex-direction: column-reverse; }
  .bubble[data-grow="up"] .actions { padding: 2px 0 8px; }

  /* Reversing the column moves no borders: the separators in front of the
     second layer change sides by width, colour and style stay put. */
  .bubble[data-grow="up"] .context,
  .bubble[data-grow="up"] .entries {
    margin: 0 0 8px;
    padding: 0 0 8px;
    border-width: 0 0 1px;
  }

  /* The strip for the scroll mark is not the mirror's business, and the
     shorthand above would take it away. */
  .bubble[data-grow="up"] .entries { padding-right: 0.9em; }

  /* The launcher is its row under its signature, so the row's padding - which
     exists to stand the row off a gloss that is not there - goes too; the
     signature's own margin is the whole gap above it. After the mirror, whose
     padding this outranks by standing below it. The quiet bubble (D120) is the
     same shape with two pictures in the row. */
  .bubble[data-variant="launcher"] .actions,
  .bubble[data-variant="quiet"] .actions { padding: 0; }

  /* An error bubble is not a translation, and it drops the mirror's rule for
     the same reason the mirror exists: the near edge belongs to the eye's way
     back, and when the bubble is an apology with one way out, the way out is
     what should lie on it. The order moves only the row of actions - a recall
     bubble whose save failed keeps its second layer where the mirror put it,
     borders and all. */
  .bubble[data-tone="error"][data-grow="up"] .reveal { order: -1; }
  .bubble[data-tone="error"][data-grow="up"] .actions { padding: 8px 0 2px; }

  /* The signature, on the two bubbles that have to say who is talking. A
     translation needs none - the answer is the point, and a header would cost
     the line D23 saved - but an error may be the first thing this extension
     ever shows somebody, and an unsigned complaint floating over a page reads
     as the page's own.

     The launcher (D126) has the same problem in a different tense: one
     unlabelled offer standing over somebody else's page, and on Android it is
     the default mode, so it is the first thing the extension does at all. The
     word is the answer to both halves of the question - who is asking, and
     where the press leads: it is the same word the reader page's own header
     says, so the offer and its destination sign the same name. */
  .brand {
    display: none;
    font-size: calc(11px * var(--bubble-scale, 1));
    font-weight: 600;
    letter-spacing: 0.03em;
    opacity: 0.6;
    margin-bottom: 4px;
  }
  .bubble[data-tone="error"] .brand,
  .bubble[data-variant="launcher"] .brand { display: block; }
  /* A signature signs at the top, also when the mirror reverses the column. */
  .bubble[data-tone="error"][data-grow="up"] .brand,
  .bubble[data-variant="launcher"][data-grow="up"] .brand { order: 1; }

  /* An action is a label and not a control. What makes one findable is standing
     where the reader is already looking; a box around it would make it the
     loudest thing in a bubble whose whole job is one line of translation. */
  .actions button {
    font: inherit;
    font-size: calc(var(--type-action) * var(--bubble-scale, 1));
    margin: 0;
    padding: var(--pad-action);
    color: inherit;
    background: none;
    border: 0;
    border-radius: 4px;
    opacity: 0.7;
    cursor: pointer;
  }
  /* A label carries padding so that a focus ring has somewhere to go, and the
     first one gives it back: the row has to start on the same vertical line as
     the gloss above it. Save, the launcher and Settings bring their own box
     and need no pulling. */
  .actions button:first-child:not([data-action="save"]):not([data-action="reader"]):not([data-action="settings"]) { margin-left: var(--pull-action); }
  .actions button:hover:not(:disabled) { opacity: 1; }
  .actions button:focus-visible {
    opacity: 1;
    outline: 1px solid currentColor;
    outline-offset: 0;
  }
  .actions button:disabled { opacity: 0.35; cursor: default; }

  /* The clipboard row (D110): an extra row the copy icon opens, so Save never
     leaves the screen for it. It reads like the action row - quiet labels,
     one starting line with the gloss - and lives outside the fold: the icon
     that opens it is inside the fold already, so a visible row implies an
     unfolded bubble. Put away by the hidden attribute, whose rule above
     outranks this display. */
  .copy-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--gap-actions);
    padding: 2px 0;
  }
  .copy-row button {
    font: inherit;
    font-size: calc(var(--type-action) * var(--bubble-scale, 1));
    margin: 0;
    padding: var(--pad-action);
    color: inherit;
    background: none;
    border: 0;
    border-radius: 4px;
    opacity: 0.7;
    cursor: pointer;
  }
  .copy-row button:first-child { margin-left: var(--pull-action); }
  .copy-row button:hover { opacity: 1; }
  .copy-row button:focus-visible {
    opacity: 1;
    outline: 1px solid currentColor;
    outline-offset: 0;
  }

  /* The speaker is the row's one picture (D83): universally readable where a
     "Read aloud" label would push the row past one line on a phone, and an
     honest signal that it acts on the phrase itself, not on the vocabulary.
     Inline-flex centers the icon in the same box the text labels get, and the
     icon matches their cap height, so the row keeps one baseline rhythm. */
  .actions button[data-action="speak"],
  .actions button[data-action="copy"] {
    display: inline-flex;
    align-items: center;
  }
  .actions button[data-action="speak"] svg,
  .actions button[data-action="copy"] svg {
    width: var(--icon);
    height: var(--icon);
    display: block;
  }

  /* The exception, and the only real call to action a bubble has: Save is the
     press that keeps a phrase which would otherwise be gone, the launcher's
     offer is what its bubble is for, and Settings is the one thing an error
     bubble can offer - none of the three ever shares a screen with another, so
     none outshouts the rest. The launcher's second door (D129) deliberately
     stays a plain label beside the framed one: it is the way to another room,
     not another answer to "what do I do with this page", and two frames side
     by side would make a menu out of an offer. */
  .actions button[data-action="save"],
  .actions button[data-action="reader"],
  .actions button[data-action="settings"] {
    font-size: calc(var(--type-cta) * var(--bubble-scale, 1));
    padding: var(--pad-cta);
    opacity: 1;
    /* What makes these three look pressable is the box, and the box has to be
       there on paper too: the tint inside it is the first thing an e-ink panel
       rounds away, and a Save that has lost its frame is one more label in a
       row of labels. */
    background: rgba(0, 0, 0, 0.05);
    border: 1px solid var(--edge);
    border-radius: 6px;
  }
  .actions button[data-action="save"]:hover:not(:disabled),
  .actions button[data-action="reader"]:hover:not(:disabled),
  .actions button[data-action="settings"]:hover:not(:disabled) { background: rgba(0, 0, 0, 0.1); }
  .actions button[data-action="save"]:disabled { opacity: 0.45; }

  /* A hand is not a cursor: where the primary pointer is a finger, the type
     steps up toward the page's own reading size and the presses grow into
     targets. Sizing only - the reveal mechanic deliberately has no touch
     branch (D44), and a hybrid using its mouse loses nothing to bigger type. */
  @media (pointer: coarse) {
    .bubble {${TOUCH_SIZES}}
  }

  /* The same tier by the gesture's own word (D84): the pointer that made the
     selection is the pointer about to press these buttons, and the media
     query can answer for the wrong device - a Boox e-ink tablet reports a
     fine primary pointer over its touch screen, and got desktop type on a
     7-inch slate. Only ever forced up, never down: a mouse selection on a
     device whose media query says coarse keeps the bigger type, for the
     hybrid's reason above. */
  .bubble[data-pointer="coarse"] {${TOUCH_SIZES}}

  @media (prefers-color-scheme: dark) {
    .bubble {
      /* A step lighter than the dark themes it floats over, because the
         shadow that separates the planes on glass does not exist on black
         and quantizes away on e-ink - the background difference and the
         border have to do it alone (reported from a phone: the bubble sank
         into the reader's dark theme). */
      background: #262c3a;
      color: #f2f4f8;
      /* The one strength against this paper instead of white, and a step
         lighter than page.css uses for the same job, because this paper is a
         step lighter than the pages' - 4.6:1 either way. Every line in the
         bubble reads it, so the dark theme is this one colour plus the washes
         that only glass can show. */
      --edge: #8d95a6;
      border-color: var(--edge);
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
    }
    .body[data-tone="error"],
    .context[data-tone="error"] { color: #f09a3e; }
    .bubble:not([data-pointer="coarse"]) .entry-sense[aria-pressed="false"]:hover:not(:disabled) { background: rgba(255, 255, 255, 0.08); }
    .entry-sense[aria-pressed="true"] { background: rgba(255, 255, 255, 0.1); }
    .editor { background: rgba(255, 255, 255, 0.06); }
    /* The quiet labels need nothing here: they are the bubble's own colour at
       seven tenths, which lands right on either background. */
    .actions button[data-action="save"],
    .actions button[data-action="reader"],
    .actions button[data-action="settings"] { background: rgba(255, 255, 255, 0.08); }
    .actions button[data-action="save"]:hover:not(:disabled),
    .actions button[data-action="reader"]:hover:not(:disabled),
    .actions button[data-action="settings"]:hover:not(:disabled) { background: rgba(255, 255, 255, 0.16); }
  }
`;

/** `note` is an aside in the second layer - the fetch behind More coming back
 *  with nothing - and never a body's tone. @typedef {"normal" | "pending" | "error" | "note"} Tone */
/** Which of the four bubbles this is. `launcher` is reader-only mode's own
 *  bubble: no gloss, one framed offer and, beside it, the quiet way to the
 *  reading list (D129). `quiet` is the translation-off trim (D120):
 *  no gloss either, and the row is the speaker and the clipboard - the
 *  phrase's own two acts, all that is left without an engine.
 *  @typedef {"recall" | "save" | "launcher" | "quiet"} Variant */
/** What the bubble can offer. `speak` and `copy` are the row's two pictures -
 *  a speaker icon that reads the phrase aloud (D83), and a copy icon that
 *  opens the clipboard row (D110).
 *  @typedef {"save" | "learned" | "edit" | "settings" | "more" | "reader" | "library" | "speak" | "copy"} Action */
/** The clipboard row's two presses (D110) - the bubble's own business, like
 *  editing: never offered by a caller, never reported to one.
 *  @typedef {"copy-original" | "copy-translation"} CopyChoice */
/** What it reports - editing never leaves the bubble, and More leaves it only
 *  on the press that opens the layer, so a caller with nothing fetched yet can
 *  fetch it then. @typedef {"save" | "choose" | "learned" | "settings" | "reader" | "library" | "more" | "speak"} ReportedAction */

/**
 * One block of the second layer below the sentence: where it came from, and the
 * lines it has to show. The bubble is handed labels rather than dictionary
 * records on purpose - deciding whether a book's name or a headword is worth
 * repeating needs to know what the reader selected, and the bubble does not.
 *
 * One line is one meaning and therefore one button. The caller guarantees that,
 * because the caller is where a dictionary's idea of a line stops mattering:
 * whatever a book packed into one field, what a reader presses here has to be
 * something that can stand alone as the answer to a word.
 *
 * @typedef {{ label: string, lines: string[] }} Block
 */

/**
 * `folded` is where the row of actions starts, and the whole of that decision
 * (D131): the caller holds the quiet-bubble setting (D81) and hands it down
 * on every opening, so one checkbox answers for the bubble over a fresh
 * selection and the bubble over an underline alike. Said nothing, the row is
 * out. `reveal()` is the caller's way to bring it out after all when one
 * button turns out to be the point (Save, an error's way to settings).
 *
 * `anchored` pins the bubble to the page rather than to the viewport: the
 * host goes `absolute` at the document coordinates the anchor had when shown,
 * so scrolling carries the bubble with the phrase it is about - the reader
 * page's mode, where the bubble is a margin note, not a popup. Later growth
 * re-places against the screen of that later moment - the phrase has not
 * moved in the document, but the reader may have scrolled it anywhere, and
 * where there is room is a question about now. It is also the one mode that
 * may move the page itself (D97): when the grown bubble has no room beside
 * the phrase, the page scrolls the two into view together instead of the
 * bubble covering what it is about. `line` is that mode's one measurement -
 * the height of the phrase's first line, the part that must stay on the
 * screen when the whole phrase cannot.
 *
 * `follow` is the viewport-pinned bubble's half of riding a scroll (D82):
 * handed the anchor's fresh rect, it re-anchors and moves rigidly by the
 * offset of the last real placement - the anchored mode needs no such call,
 * because the document carries it.
 *
 * `coarse` says the selection was made by a finger or a pen, and sizes the
 * bubble for one (D84) - the stylesheet's touch tier, applied over whatever
 * the pointer media query believes, because on some devices it believes
 * wrong. It is a separate flag from `touch` on purpose: `touch` means "the
 * system's bar and handles stand around this selection" and decides distance,
 * and the reader page's own gesture is exactly the case where a finger
 * selects with no system furniture at all - coarse without touch.
 *
 * `scale` multiplies every size in the bubble - the settings knob (D85),
 * handed in as a plain factor with 1 meaning "as designed".
 *
 * `phrase` is the selection's text as the page had it, held for the clipboard
 * row's "copy original" press (D110) and never rendered: what says which
 * phrase the bubble is about stays the page's own highlight (D23).
 *
 * @typedef {object} Tooltip
 * @property {(options: { anchor: DOMRect, variant: Variant, body: string, tone?: Tone, actions?: Action[], touch?: boolean, coarse?: boolean, scale?: number, folded?: boolean, anchored?: boolean, line?: number, phrase?: string }) => void} show
 * @property {(body: string, tone?: Tone) => void} setBody
 * @property {(sentence: string | null, tone?: Tone) => void} setContext
 * @property {(blocks: Block[]) => void} setEntries
 * @property {(actions: Action[]) => void} setActions
 * @property {(rect: DOMRect) => void} follow
 * @property {() => void} reveal
 * @property {() => void} hide
 * @property {() => boolean} isOpen
 * @property {() => boolean} isEditing
 * @property {() => void} escape
 * @property {(target: EventTarget | null) => boolean} owns
 */

/**
 * Puts the bubble's stylesheet into its shadow root, two ways.
 *
 * A constructed sheet first, because the bubble also opens on the extension's
 * own reader page, where the content security policy allows no inline style -
 * and a sheet built through the CSSOM is not inline style to CSP.
 *
 * The `<style>` element second, because a constructed sheet has to cross the
 * boundary between a content script and the page it runs in, and that is
 * exactly the kind of thing a browser is allowed to refuse quietly. It is
 * checked rather than assumed: an assignment that did not take leaves the list
 * empty, and the fallback is what worked on every page before this. On the
 * reader page the fallback would be blocked by CSP, which is the right way
 * round - an unstyled bubble in one place beats an unstyled bubble everywhere.
 *
 * @param {ShadowRoot} root
 */
function style(root) {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(STYLE);
    root.adoptedStyleSheets = [sheet];
    if (root.adoptedStyleSheets.length === 1) return;
  } catch {
    // Not supported, or refused. Either way there is another way to do it.
  }

  const element = document.createElement("style");
  element.textContent = STYLE;
  root.append(element);
}

/**
 * Where the bubble goes, given where the phrase is and how much room there is
 * around it.
 *
 * The answer is one line and a direction, not a rectangle, and that is the
 * point: the bubble is pinned by the edge nearest the phrase, so everything
 * that makes it taller - a row of actions unfolding, a sentence arriving -
 * moves the far edge and leaves the line being read exactly where it was.
 * `top` is where that near edge lies, `grow` is which way the rest of the
 * bubble hangs off it - and hanging upward is the stylesheet's job (see
 * `data-grow`), never a `bottom:` computed from the viewport's height:
 * Firefox on Android walks bottom-anchored fixed elements up and down with
 * its dynamic toolbar, and a bubble pinned that way landed on the very
 * phrase it was about whenever the toolbar was away (D77).
 *
 * Pinning an edge in CSS rather than placing the bubble again is also what
 * lets the row unfold in the stylesheet: by the time it starts growing there
 * is nothing here left to run.
 *
 * Above the phrase when there is room: reading goes downwards, so the text
 * above has been read and the text below is what comes next (D23) - restored
 * for touch after a round of reading with the bubble below (D74 revision,
 * Michał's call). What a touch selection changes is the distance, not the
 * side: the bubble stands a system strip away (`SYSTEM_GAP`), leaving the
 * space between itself and the phrase to the browser's own selection bar
 * above it, or to its drag handles below it, so the two never cover each
 * other.
 *
 * When neither side has the room, two endings (D97). On a page that is not
 * ours the bubble covers the phrase - the last resort below, as much of it
 * on the screen as there is screen. With `assist` - the reader's anchored
 * mode, where bubble and phrase are pinned to the same document and the page
 * is ours to move - it goes below the phrase instead and answers `scroll`:
 * how far the page has to move so that the phrase and the bubble stand on
 * the screen together. A long phrase keeps every line when the window can
 * hold them and its first line when it cannot (`line`) - which line the
 * bubble is about must survive, the tail of a five-line phrase may not cost
 * the dictionary its box.
 *
 * @param {object} where
 * @param {{ top: number, bottom: number, left: number }} where.anchor the phrase, in viewport coordinates
 * @param {{ width: number, height: number }} where.size what the bubble measures now
 * @param {{ width: number, height: number }} where.viewport
 * @param {number} [where.folded] how much taller it is still going to get on its own
 * @param {boolean} [where.touch] whether the selection was made by touch
 * @param {number} [where.line] the height of the phrase's first line; 0 means unknown, and the whole phrase is kept
 * @param {boolean} [where.assist] whether the page can be scrolled to make room - only ever the reader's anchored mode
 * @param {number} [where.covered] how far down the window the page's own stuck bar reaches (D138); the usable room starts under it
 * @returns {{ left: number, top: number, grow: "down" | "up", scroll?: number }}
 */
export function placement({ anchor, size, viewport, folded = 0, touch = false, line = 0, assist = false, covered = 0 }) {
  // The room to look for is the room the bubble may come to need, not the room
  // it needs now - a folded row unfolds with nobody left to move anything.
  const height = size.height + folded;

  const maxLeft = Math.max(VIEWPORT_MARGIN, viewport.width - size.width - VIEWPORT_MARGIN);
  const left = Math.round(Math.min(Math.max(VIEWPORT_MARGIN, anchor.left), maxLeft));

  const gap = touch ? SYSTEM_GAP : GAP;

  // Where the room begins (D138): the window's margin, moved down by whatever
  // the page's own bar has stuck over the text - a spot beneath the bar is
  // painted over, for the bubble and for the assist's kept line alike.
  const ceiling = covered + VIEWPORT_MARGIN;

  if (anchor.top - gap - height >= ceiling) {
    return { left, top: Math.round(anchor.top - gap), grow: "up" };
  }

  // Below it, and pushed up only by the bottom of the window: the most of it
  // that can be on the screen is on the screen, even over the phrase. With
  // the assist, "below it" has to hold without the clamps - a spot the clamps
  // would move is a spot the scroll can honestly reach instead, and a phrase
  // sunk beneath the bar is one the scroll can bring back out.
  const below = anchor.bottom + gap;
  const room = viewport.height - VIEWPORT_MARGIN - height;
  if (!assist || (below >= ceiling && below <= room)) {
    return { left, top: Math.round(Math.max(ceiling, Math.min(below, room))), grow: "down" };
  }

  // The scroll assist (D97). Below the phrase - or below its first line, when
  // the window cannot hold the bubble and every line of the phrase at once -
  // and the page moves the rest of the way: at least far enough to bring the
  // bubble's foot in, never so far that the line the bubble is about leaves
  // through the top - or under the bar (D138).
  const whole = anchor.bottom - anchor.top;
  const kept = height + gap + whole <= viewport.height - VIEWPORT_MARGIN - ceiling || line <= 0 ? whole : Math.min(line, whole);
  const top = anchor.top + kept + gap;
  const need = top + height - (viewport.height - VIEWPORT_MARGIN);
  const cap = anchor.top - ceiling;
  return { left, top: Math.round(top), grow: "down", scroll: Math.round(Math.min(Math.max(0, need), cap)) };
}

/**
 * How far the bubble has to move for what matters in it to sit inside what is
 * visible - the editing bubble's answer to the software keyboard (D97), which
 * takes the bottom of the screen without telling the layout anything. `must`
 * is the box that has to be seen, `view` the part of the window the keyboard
 * left, both in the same coordinates; the answer is the offset to add to the
 * bubble's position, zero when it already stands clear. When even the must-box
 * does not fit, its top wins: the box being typed in starts there.
 *
 * A pure rule apart from the listeners that ask it, for the test's sake -
 * like `placement` above.
 *
 * @param {{ must: { top: number, bottom: number }, view: { top: number, bottom: number } }} boxes
 * @returns {number}
 */
export function revealShift({ must, view }) {
  const floor = view.top + VIEWPORT_MARGIN - must.top;
  const ceil = view.bottom - VIEWPORT_MARGIN - must.bottom;
  if (floor > ceil) return Math.round(floor);
  return Math.round(Math.min(Math.max(0, floor), ceil));
}

/**
 * How far back the page goes when the bubble that moved it leaves (D138).
 *
 * The scroll assist and the keyboard reveals move the reader's page to make
 * room (D97), and the reason for that room leaves with the bubble - a page
 * left where the assist put it strands the reader: the line they were reading
 * stands where the bubble wanted it, at the very top, under the reader's own
 * stuck bar. `shown` is where the page stood when the bubble opened, `now`
 * where it stands as it closes, `carried` the sum of what the bubble itself
 * scrolled, all as performed. The answer is what to scroll by: back to
 * `shown` when the whole drift was the bubble's own doing, nothing at all
 * when the reader has scrolled meanwhile - a hand on the page outranks the
 * tidying. The tolerance absorbs engines that land scrolls on device pixels;
 * half-pixel drift is rounding, not a reader.
 *
 * A pure rule apart from the scroll that spends it, like the two above.
 *
 * @param {{ shown: number, now: number, carried: number }} scrolls
 * @returns {number}
 */
export function settleBack({ shown, now, carried }) {
  if (carried === 0) return 0;
  const drift = now - shown;
  return Math.abs(drift - carried) <= 2 ? -drift : 0;
}

/**
 * @param {object} options
 * @param {(action: ReportedAction, meanings: string[]) => void} options.onAction what the reader pressed, and what the bubble was showing when they did
 * @param {() => void} [options.onHide] told as the bubble leaves the screen,
 *   whichever door it left by - the caller's chance to stop what only made
 *   sense while it was up (a phrase being read aloud, D83)
 * @param {() => number} [options.covered] how far down the window the caller's
 *   own stuck chrome reaches (D138) - the reader's bar. Asked at every
 *   placement, because panels make the bar taller for as long as they are
 *   open: the room to place in starts under it, the scroll assist (D97) parks
 *   the kept line just below it, and the keyboard's reveals count the strip
 *   as unseen. Absent means nothing stands over the text.
 * @returns {Tooltip}
 */
export function createTooltip({ onAction, onHide, covered }) {
  /** The live measure of the caller's stuck chrome (D138), with the
   *  every-other-page answer standing in when the caller has none. */
  const coveredAbove = covered ?? (() => 0);
  /** @type {HTMLDivElement | null} */
  let host = null;
  /** @type {HTMLDivElement | null} */
  let bubble = null;
  /** @type {HTMLDivElement | null} */
  let bodyElement = null;
  /** @type {HTMLDivElement | null} */
  let contextElement = null;
  /** @type {HTMLDivElement | null} */
  let contextTextElement = null;
  /** @type {HTMLButtonElement | null} */
  let contextToggle = null;
  /** @type {HTMLDivElement | null} */
  let entriesElement = null;
  /** @type {HTMLTextAreaElement | null} */
  let editor = null;
  /** @type {HTMLDivElement | null} */
  let actionsElement = null;
  /** The clipboard row (D110): two presses that put the phrase or its gloss
   *  onto the clipboard. Built once and toggled by the copy icon - an extra
   *  row rather than a swap of the action row, so Save stays on the screen
   *  and copying is never a step away from keeping. */
  /** @type {HTMLDivElement | null} */
  let copyRowElement = null;

  /** Where the bubble is anchored, so it can be placed again when it changes size. */
  let anchor = new DOMRect();
  /** The height of the anchor's first line - what the scroll assist keeps on
   *  the screen when a long phrase cannot keep every line (D97). Zero when
   *  the caller did not say, which keeps the whole phrase. */
  let anchorLine = 0;
  /** Whether the anchor is a selection made by touch, kept with it for the
   *  same reason: every re-placement has to answer it again. */
  let onTouch = false;
  /**
   * Where the page stood when the bubble was shown - and the anchored mode's
   * whole switch: null pins the host to the viewport (`fixed`, every page's
   * mode), a pair pins it to the document (`absolute`, the reader's), where
   * the anchor rect and this scroll offset together name a fixed spot in the
   * text that scrolling never moves.
   *
   * @type {{ x: number, y: number } | null}
   */
  let page = null;
  /**
   * Where the last placement put the bubble, relative to its anchor - what
   * `follow` preserves: a bubble riding its phrase through a scroll (D82)
   * moves rigidly with it, never re-deciding sides or clamping mid-motion.
   */
  let placedOffset = { top: 0, left: 0 };
  /**
   * How far the bubble itself has scrolled the reader's page since it was
   * shown - the assist rides and the keyboard reveals (D97), summed as
   * actually performed, clamps and all. What hide undoes (D138): the page
   * went there to make room for the bubble, and the reason leaves with it.
   * Only ever nonzero in the anchored mode, the one whose page is ours.
   */
  let carried = 0;
  let editing = false;
  /** Whether the second layer is unfolded. Folded again for every new phrase. */
  let unfolded = false;
  /** Whether the sentence is clamped to one line (D96). The reader's choice,
   *  so it survives re-renders of the layer - but not the next phrase. */
  let contextFolded = false;
  /** Whether the click the last press becomes is the one that unfolded the row. */
  let swallowClick = false;
  /** What the buttons were before the edit box opened, to go back to on cancel. */
  /** @type {Action[]} */
  let restingActions = [];
  /**
   * What this bubble's phrase says, as the page had it - the copy row's other
   * half (D110). Never rendered: the bubble still does not repeat its phrase
   * (D23), it only holds the string a copy press writes out.
   */
  let phraseText = "";
  /** The clipboard row's feedback timer, and the press it is about (D110). */
  /** @type {{ timer: number, button: HTMLButtonElement, choice: CopyChoice } | null} */
  let copied = null;

  /**
   * What the bubble is showing as the gloss - which is the edit box while there
   * is one, because that is what a save would take.
   *
   * @returns {string}
   */
  function shownGloss() {
    if (editing && editor !== null) return editor.value;
    return bodyElement?.textContent ?? "";
  }

  /**
   * @returns {string[]}
   */
  function currentMeanings() {
    return toMeanings(shownGloss());
  }

  function build() {
    if (host !== null) return;

    host = document.createElement("div");
    // Inline and important, because `:host { all: initial }` inside the shadow
    // root cannot win against a page rule that targets our element from outside.
    host.style.setProperty("all", "initial", "important");
    host.style.setProperty("position", "fixed", "important");
    host.style.setProperty("z-index", "2147483647", "important");
    host.style.setProperty("top", "0px", "important");
    host.style.setProperty("left", "0px", "important");
    // A full-width line of no height, not a box around the bubble: the bubble
    // hangs off it absolutely (D77) and resolves its width against this
    // width, and a strip with no height catches no taps meant for the page.
    host.style.setProperty("width", "100%", "important");
    host.style.setProperty("height", "0px", "important");

    const root = host.attachShadow({ mode: "closed" });
    style(root);

    bubble = document.createElement("div");
    bubble.className = "bubble";
    // Who is talking, for the one bubble that has to say so (see .brand). The
    // name is the manifest's, written out because a brand is not a message: it
    // reads re/read in every locale.
    const brandElement = document.createElement("div");
    brandElement.className = "brand";
    brandElement.textContent = "re/read";
    bodyElement = document.createElement("div");
    bodyElement.className = "body";
    contextElement = document.createElement("div");
    contextElement.className = "context";
    contextElement.hidden = true;
    // Two columns inside the section (D96): the sentence, and the fold in its
    // corner. Text goes into its own element so that setting it never has to
    // know the control is there.
    contextTextElement = document.createElement("div");
    contextTextElement.className = "context-text";
    contextToggle = document.createElement("button");
    contextToggle.type = "button";
    contextToggle.className = "context-toggle";
    contextToggle.hidden = true;
    contextToggle.append(chevronIcon());
    contextToggle.addEventListener("click", toggleContextFold);
    contextElement.append(contextTextElement, contextToggle);
    entriesElement = document.createElement("div");
    entriesElement.className = "entries";
    entriesElement.hidden = true;
    editor = document.createElement("textarea");
    editor.className = "editor";
    editor.hidden = true;
    editor.rows = 1;
    // The row of actions inside the one element that folds. Nothing outside
    // this function ever needs the wrapper: what unfolds it is a stylesheet.
    const revealElement = document.createElement("div");
    revealElement.className = "reveal";
    actionsElement = document.createElement("div");
    actionsElement.className = "actions";
    revealElement.append(actionsElement);
    // The clipboard row (D110), built once and toggled by the copy icon. Its
    // two presses are fixed - what changes between phrases is only the strings
    // they would write out, and those are read at press time.
    copyRowElement = document.createElement("div");
    copyRowElement.className = "copy-row";
    copyRowElement.hidden = true;
    for (const choice of /** @type {CopyChoice[]} */ (["copy-original", "copy-translation"])) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset["action"] = choice;
      button.textContent = label(choice);
      button.addEventListener("click", () => copyOut(button, choice));
      copyRowElement.append(button);
    }

    // Pressing a button must not take the selection away: the page's own
    // selection is what the bubble is about, and it disappearing under the
    // cursor reads as the extension breaking the page. The dictionary entries
    // are in this for the same reason now that a line of one can be pressed -
    // the bubble deliberately does not repeat the phrase it is about (D23), so
    // the selection is the only thing on the screen still saying which word all
    // of this is an answer to. The price is that text in there cannot be
    // selected with the mouse, which nothing in the bubble is for. The
    // sentence's section joined when its corner grew the fold (D96). The
    // clipboard row is in it twice over: copying exists exactly so the phrase
    // can leave the page, and a press that dropped the selection would take
    // away the very thing Ctrl+C is about to copy (D110).
    for (const element of [actionsElement, copyRowElement, entriesElement, contextElement]) {
      element.addEventListener("mousedown", (event) => event.preventDefault());
    }
    editor.addEventListener("input", onEditorInput);
    editor.addEventListener("keydown", onEditorKeyDown);
    // Typing in this box must not reach the page. Plenty of sites bind single
    // letters as shortcuts, and a correction typed into the bubble that also
    // scrolls the article is worse than no edit box at all. Our own Escape
    // handler is unaffected: it listens in the capture phase, which runs first.
    for (const type of ["keyup", "keypress"]) {
      editor.addEventListener(type, (event) => event.stopPropagation());
    }
    // Only the half of the unfolding that a stylesheet cannot do (see `reveal`):
    // showing the row is a `:hover` rule, so no cursor is tracked anywhere and
    // nothing on the page below gains a listener. A press is the exception and
    // has to be a listener, because CSS cannot tell the press that asks for the
    // row from the press that uses it - and on a touch screen they are the same
    // gesture twice (see `onPointerDown`).
    bubble.addEventListener("mouseenter", reveal);
    bubble.addEventListener("focusin", reveal);
    bubble.addEventListener("pointerdown", onPointerDown);
    // Capture, which is the whole of how a swallowed click is swallowed: stopped
    // here, it never reaches the button it would have pressed.
    bubble.addEventListener("click", onClick, { capture: true });

    // In the order of their distance from the phrase, which is the one order
    // the stylesheet's mirror can reverse whole: the gloss and the box that
    // edits it, then the actions with the clipboard row they open (D110),
    // then the second layer. The signature stands before them all and outside
    // the order: only the error tone shows it (see .brand).
    bubble.append(brandElement, bodyElement, editor, revealElement, copyRowElement, contextElement, entriesElement);
    root.append(bubble);
    // `documentElement` and not `body`: single-page applications replace the
    // body, and a bubble that vanishes with a re-render is a bug nobody can
    // reproduce.
    document.documentElement.append(host);
  }

  /**
   * The row of actions, out and staying out.
   *
   * What shows it is a `:hover` rule, and CSS keeps it shown for exactly as long
   * as the pointer is inside. This is the rest: once somebody has gone looking
   * for the actions, they are there until the bubble is gone. A class and not a
   * hover state, because the two disagree the moment the pointer leaves - and
   * the row winking out mid-reach is the flicker this is here to avoid.
   */
  function reveal() {
    bubble?.classList.add("revealed");
  }

  /**
   * Whether the row of actions is clipped away to nothing at this moment.
   *
   * Asked of the element and not of the variant or of the class, because both
   * can disagree with the screen: a bubble that opens under a resting cursor is
   * unfolded by `:hover` alone, with nothing in here ever told about it. What
   * the callers need to know is whether there is anything to press, and only the
   * element knows that.
   *
   * @returns {boolean}
   */
  function folded() {
    if (actionsElement === null) return false;
    return actionsElement.clientHeight === 0 && actionsElement.scrollHeight > 0;
  }

  /**
   * A press inside the bubble, and on a touch screen the only way in: a finger
   * cannot arrive anywhere without pressing it.
   *
   * So the press unfolds the row, exactly as a cursor arriving would - and then
   * has to answer for what it unfolded under itself. The finger is still down
   * where a button is about to be, so the click this press turns into is
   * swallowed: the gesture that asks for the actions may not also use one.
   * Touching an underline is a decision about recall, not about managing a
   * phrase (D22 draws the same line), and Learned is one press further in.
   *
   * Every press decides this again, which is also what disarms it: the press
   * that follows finds the row out and goes through untouched.
   */
  function onPointerDown() {
    swallowClick = folded();
    reveal();
  }

  /**
   * @param {Event} event
   */
  function onClick(event) {
    if (!swallowClick) return;
    swallowClick = false;
    event.stopPropagation();
  }

  /**
   * @param {KeyboardEvent} event
   */
  function onEditorKeyDown(event) {
    event.stopPropagation();
    // Enter saves, shift+Enter is the way to add a second meaning. A textarea
    // whose Enter key does nothing but grow it would need the mouse for every
    // correction.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      emit("save");
    }
  }

  /**
   * Every control the bubble has, made to agree with what it is showing: there
   * is nothing to save when there is no meaning left, the chosen dictionary line
   * is the one the gloss came from, and none of them can be chosen while the
   * gloss is being typed by hand - a press that overwrote the edit box would
   * throw away what somebody was in the middle of writing.
   */
  function refreshControls() {
    const shown = new Set(currentMeanings());

    if (actionsElement !== null) {
      for (const button of actionsElement.querySelectorAll("button")) {
        if (button.dataset["action"] === "save") button.disabled = shown.size === 0;
      }
    }

    if (entriesElement !== null) {
      for (const sense of entriesElement.querySelectorAll("button")) {
        sense.disabled = editing;
        // A line is marked when it is one of the meanings on show - which is
        // also true of a line the reader typed by hand into the edit box, and
        // that is honest: what the mark says is "this is in", not "you pressed
        // this".
        sense.setAttribute("aria-pressed", shown.has(sense.textContent ?? "") ? "true" : "false");
      }
    }
  }

  /**
   * The feedback taken back: the pressed button says its own name again, and
   * the width lock that kept the row from jumping goes with it.
   */
  function settleCopy() {
    if (copied === null) return;
    window.clearTimeout(copied.timer);
    copied.button.textContent = label(copied.choice);
    copied.button.style.minWidth = "";
    copied = null;
  }

  /** The disclosure icon, kept honest about the row it toggles. */
  function syncCopyIcon() {
    if (actionsElement === null || copyRowElement === null) return;
    const icon = actionsElement.querySelector('button[data-action="copy"]');
    icon?.setAttribute("aria-expanded", copyRowElement.hidden ? "false" : "true");
  }

  /**
   * The clipboard row, put away - by the icon pressed again, by Escape, and
   * by every change of what the bubble is about (a new phrase, new buttons):
   * the row's presses copy what is on show, and a row that outlived the show
   * would copy something the screen no longer says.
   */
  function hideCopyRow() {
    settleCopy();
    if (copyRowElement === null || copyRowElement.hidden) return;
    copyRowElement.hidden = true;
    syncCopyIcon();
    place();
  }

  /** The copy icon pressed: the row comes out, or goes back in. */
  function toggleCopyRow() {
    if (copyRowElement === null) return;
    if (!copyRowElement.hidden) {
      hideCopyRow();
      return;
    }
    // With nothing shown as the answer there is nothing its press could copy
    // (`copyOut` would refuse) - a dead button in a two-button row reads as a
    // breakage, so it steps out. The quiet bubble (D120) is where this stands
    // every time; an ordinary bubble always has a gloss by the time the icon
    // is offered at all.
    const translationButton = copyRowElement.querySelector('button[data-action="copy-translation"]');
    if (translationButton instanceof HTMLElement) translationButton.hidden = shownGloss().length === 0;
    copyRowElement.hidden = false;
    syncCopyIcon();
    place();
  }

  /**
   * One of the clipboard row's presses (D110). What goes out is what the
   * bubble is standing over right now: the phrase as the page had it, or the
   * gloss as shown - the edit box's text while there is one, because that is
   * what a save would take too. The feedback is the button saying "copied"
   * for a breath, its width locked so the row does not jump; a clipboard that
   * refuses (no user activation, a locked-down profile) gets no feedback at
   * all - the button does not claim a copy it did not make.
   *
   * @param {HTMLButtonElement} button
   * @param {CopyChoice} choice
   */
  async function copyOut(button, choice) {
    const text = choice === "copy-original" ? phraseText : shownGloss();
    if (text.length === 0) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    // The press may have raced the bubble closing or another copy's feedback;
    // whatever stood before, this press's word is the one that shows now.
    settleCopy();
    if (button.isConnected === false) return;
    button.style.minWidth = `${button.getBoundingClientRect().width}px`;
    button.textContent = t("bubble_copied");
    copied = { timer: window.setTimeout(settleCopy, 1500), button, choice };
  }

  /**
   * @param {Action | "cancel" | "choose"} action
   */
  function emit(action) {
    // Editing is the bubble's own business: nobody outside needs to know that a
    // text box opened, only what it said when the reader was done with it.
    if (action === "cancel") {
      stopEditing(false);
      return;
    }
    // So is the clipboard (D110): copying writes nothing to the vocabulary,
    // and everything a copy press writes out is already in here.
    if (action === "copy") {
      toggleCopyRow();
      return;
    }
    // Every other press is a turn away from copying, and the clipboard row
    // steps aside for it (Michał's report: it stayed up over the edit box
    // and over More's layer). The speaker is the one exception: hearing the
    // phrase changes nothing the row is about, and closing it would make
    // listen-then-copy cost an extra press.
    if (action !== "speak") hideCopyRow();
    if (action === "edit") {
      startEditing();
      return;
    }
    if (action === "more") {
      const opening = !unfolded;
      unfold(opening);
      // Only the press that opens the layer is reported, and after the layer
      // is open: a caller that still has to fetch what goes down there puts a
      // pending line into a layer already showing, and the press that folds
      // the layer away must not start a second fetch.
      if (opening) onAction("more", currentMeanings());
      return;
    }

    const meanings = currentMeanings();
    if (action === "save" || action === "choose") {
      if (meanings.length === 0) return;
      // Optimistic: what was typed is what the bubble shows from now on. The
      // caller decides what it means, and says so by setting the buttons - or
      // by taking the bubble away.
      stopEditing(true);
    }
    onAction(action, meanings);
  }

  /**
   * A line of a dictionary entry, pressed.
   *
   * It writes what Save writes: this is what the phrase means from now on - one
   * meaning longer, or one shorter. It goes out under its own name all the same,
   * because the two presses end differently. Save is somebody finished with a
   * phrase and the bubble gets out of the way; a line is somebody assembling
   * one, and the next line has to still be there to press.
   *
   * @param {string} sense
   */
  function choose(sense) {
    if (bodyElement === null) return;
    const next = afterChoosing(bodyElement.textContent ?? "", sense);
    // Taking out the last meaning there was. A phrase means something or it is
    // not kept at all, so this press does nothing rather than emptying it.
    if (next.length === 0) return;

    setBody(next);
    place();
    emit("choose");
  }

  /**
   * What the fold's state looks like on the section, told from what it is.
   *
   * The clamp holds only over a sentence: a pending line or an error a retry
   * put there may not open cut to one line by a fold somebody meant for eight
   * lines of translation - the choice itself survives, and holds again when
   * a sentence is back. The control names the press it offers next, in words
   * for the screen reader and for the hovering cursor alike.
   */
  function applyContextFold() {
    if (contextElement === null || contextToggle === null) return;
    const clamped = contextFolded && (contextElement.dataset["tone"] ?? "normal") === "normal";
    contextElement.dataset["folded"] = clamped ? "true" : "false";
    contextToggle.setAttribute("aria-expanded", clamped ? "false" : "true");
    const name = foldLabel(clamped);
    contextToggle.setAttribute("aria-label", name);
    contextToggle.title = name;
  }

  /**
   * The press in the sentence's corner (D96): the clamp flips, and the layer
   * is laid out again - which is the whole of the mechanism, because every
   * placement re-squeezes the dictionary box from scratch (D79), so the lines
   * the sentence gives up arrive down there without another line here.
   */
  function toggleContextFold() {
    contextFolded = !contextFolded;
    applyContextFold();
    unfold(unfolded);
  }

  /**
   * Whether the fold has anything to do right now. Clamped, "is anything cut"
   * is the horizontal overflow the ellipsis stands for; whole, "is there
   * anything to clamp" is a second line box. Asked of the rendered element,
   * because only a layout knows where the lines broke.
   *
   * @returns {boolean}
   */
  function sentenceOverflows() {
    if (contextElement === null || contextTextElement === null) return false;
    if (contextElement.dataset["folded"] === "true") {
      return contextTextElement.scrollWidth > contextTextElement.clientWidth + 1;
    }
    const lines = document.createRange();
    lines.selectNodeContents(contextTextElement);
    return lines.getClientRects().length > 1;
  }

  /**
   * `open` is the reader's intent, and it is kept even over an empty layer:
   * a recall bubble fetches its second layer on the press that opens it, so
   * what the press asked for arrives a moment after the asking - and it has to
   * land in a layer that is already open. What actually shows is decided per
   * element, by whether it has anything to say.
   *
   * @param {boolean} open
   */
  function unfold(open) {
    if (contextElement === null || entriesElement === null) return;
    unfolded = open;
    const entriesThere = entriesElement.childElementCount > 0;
    contextElement.hidden = !unfolded || (contextTextElement?.textContent ?? "").length === 0;
    entriesElement.hidden = !unfolded || !entriesThere;
    // The fold's column comes or goes before placing: its width decides where
    // the sentence wraps, and the wrapping is measured below. Presence needs
    // no measurement - `absent` is about the entries alone (D96).
    if (contextToggle !== null) {
      contextToggle.hidden = foldControl({ entries: entriesThere, overflows: false }) === "absent";
    }
    renderActions(editing ? ["save", "cancel"] : restingActions);
    place();
    // Asked after `place`, because a hidden element has no size to compare and
    // the bubble is only its final height once it has been positioned.
    entriesElement.dataset["more"] =
      !entriesElement.hidden && entriesElement.scrollHeight > entriesElement.clientHeight + 1 ? "true" : "false";
    // The fold shows only where a press would change anything - measured, so
    // it too has to wait for the layout. Visibility and not display: taking
    // the column away would rewrap the sentence just measured, and a control
    // blinking with every re-placement is the reflow this rule avoids.
    if (contextToggle !== null && !contextToggle.hidden) {
      contextToggle.style.visibility =
        foldControl({ entries: entriesThere, overflows: sentenceOverflows() }) === "shown" ? "" : "hidden";
    }
  }

  /**
   * @param {string | null} sentence
   * @param {Tone} [tone]
   */
  function setContext(sentence, tone = "normal") {
    if (contextElement === null || contextTextElement === null) return;
    contextTextElement.textContent = sentence ?? "";
    contextElement.dataset["tone"] = tone;
    // The tone has a say in the clamp (see `applyContextFold`), so the fold is
    // told before the layer is laid out again.
    applyContextFold();
    // Shown or hidden again by what it now says - a sentence that is gone may
    // not keep a line of the bubble open over nothing.
    unfold(unfolded);
  }

  /**
   * @param {Block[]} blocks
   */
  function setEntries(blocks) {
    if (entriesElement === null) return;
    entriesElement.replaceChildren();

    for (const block of blocks) {
      const entry = document.createElement("div");
      entry.className = "entry";

      if (block.label.length > 0) {
        const label = document.createElement("div");
        label.className = "entry-label";
        label.textContent = block.label;
        entry.append(label);
      }

      // In the quiet bubble a line is prose, not a press (D121): choosing a
      // line writes a meaning (D34), and with translation off nothing writes.
      // A button that did nothing would read as a breakage, so it is not one.
      const plain = bubble?.dataset["variant"] === "quiet";
      for (const line of block.lines) {
        if (plain) {
          const sense = document.createElement("div");
          sense.className = "entry-sense";
          // Text, never markup - the rule below, same reason.
          sense.textContent = line;
          entry.append(sense);
          continue;
        }
        const sense = document.createElement("button");
        sense.type = "button";
        sense.className = "entry-sense";
        // A toggle, and told as one: pressing it makes this the meaning, and
        // pressing it again gives back the one it replaced.
        sense.setAttribute("aria-pressed", "false");
        // Every string here came out of a file somebody downloaded, so it goes
        // in as text and never as markup - the same rule that governs text
        // coming off the page.
        sense.textContent = line;
        sense.addEventListener("click", () => choose(line));
        entry.append(sense);
      }

      entriesElement.append(entry);
    }

    unfold(unfolded);
    refreshControls();
  }

  /**
   * The edit box sized to what is actually in it, as laid out - plus one
   * spare line (Michał's call): a box exactly full reads as a box with no
   * room, and the spare line is where the second meaning goes (Shift+Enter).
   * Until D97 the rows counted meanings, and one meaning wrapping on a
   * narrow screen got a one-line box showing nothing but its own tail - the
   * caret sits at the end after `select()`, and the box had scrolled to it.
   * Only a rendered element knows where its lines broke, so the box is
   * collapsed to one row and asked how far its content overflows; the cap
   * (the spare line inside it) is what keeps a long gloss from pushing the
   * Save button off a phone's screen.
   */
  function sizeEditor() {
    if (editor === null) return;
    editor.rows = 1;
    const style = window.getComputedStyle(editor);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const line = parseFloat(style.lineHeight);
    if (!Number.isFinite(line) || line <= 0) return;
    const lines = Math.round((editor.scrollHeight - padding) / line);
    editor.rows = Math.min(7, Math.max(1, lines) + 1);
  }

  /**
   * Typing changes two things at once: what a save would take (the controls'
   * business) and how many lines it takes to say it. The bubble is placed
   * again only when the box actually grew or shrank - a keystroke inside the
   * same line has moved nothing.
   */
  function onEditorInput() {
    refreshControls();
    if (editor === null) return;
    const rows = editor.rows;
    sizeEditor();
    if (editor.rows !== rows) place();
  }

  /**
   * The listeners that exist only while the edit box does (D97): the software
   * keyboard announces itself as the visual viewport shrinking, never as an
   * event of the page's own layout - and outside of editing there is nothing
   * down there to keep visible, so the bubble does not pay for them.
   *
   * @param {boolean} on
   */
  function watchKeyboard(on) {
    const vv = window.visualViewport;
    if (on) {
      vv?.addEventListener("resize", keepEditorVisible);
      vv?.addEventListener("scroll", keepEditorVisible);
      window.addEventListener("resize", keepEditorVisible);
    } else {
      vv?.removeEventListener("resize", keepEditorVisible);
      vv?.removeEventListener("scroll", keepEditorVisible);
      window.removeEventListener("resize", keepEditorVisible);
    }
  }

  /** The part of the window something can actually be seen in - the visual
   *  viewport when the browser reports one, which is the only thing that
   *  knows where the software keyboard ends, its top pushed down by the
   *  caller's own stuck chrome (D138): an editor revealed beneath the bar
   *  would be lit and unseen. In viewport coordinates.
   *  @returns {{ top: number, bottom: number }} */
  function visibleBox() {
    const vv = window.visualViewport;
    const seen =
      vv === null
        ? { top: 0, bottom: document.documentElement.clientHeight }
        : { top: vv.offsetTop, bottom: vv.offsetTop + vv.height };
    return { top: Math.max(seen.top, coveredAbove()), bottom: seen.bottom };
  }

  /**
   * The edit box, kept out from under the software keyboard (D97). What must
   * stay visible is the box being typed in and the row that saves it; the
   * whole bubble when the room the keyboard left can hold it. The anchored
   * bubble moves by scrolling the page - bubble and phrase are pinned to the
   * same document there, so the two arrive together and the phrase goes on
   * saying what is being edited. The viewport-pinned bubble has no page to
   * ride and moves itself; `placedOffset` moves with it, so a scroll mid-edit
   * does not snap it back under the keyboard.
   */
  function keepEditorVisible() {
    if (!editing || host === null || bubble === null || editor === null) return;
    const view = visibleBox();
    const box = editor.getBoundingClientRect();
    /** @type {{ top: number, bottom: number }} */
    let must = { top: box.top, bottom: box.bottom };
    const row = actionsElement?.getBoundingClientRect();
    if (row !== undefined && row.height > 0) {
      must = { top: Math.min(must.top, row.top), bottom: Math.max(must.bottom, row.bottom) };
    }
    const whole = bubble.getBoundingClientRect();
    if (whole.height <= view.bottom - view.top - 2 * VIEWPORT_MARGIN) {
      must = { top: whole.top, bottom: whole.bottom };
    }

    const shift = revealShift({ must, view });
    if (shift === 0) return;
    if (page !== null) {
      // Counted as performed, not as asked: a scroll near the document's edge
      // is clamped, and hide undoes only what actually happened (D138).
      const before = window.scrollY;
      window.scrollBy(0, -shift);
      carried += window.scrollY - before;
      return;
    }
    const top = parseFloat(host.style.top);
    if (!Number.isFinite(top)) return;
    host.style.setProperty("top", `${top + shift}px`, "important");
    placedOffset = { top: placedOffset.top + shift, left: placedOffset.left };
  }

  function startEditing() {
    if (editor === null || bodyElement === null) return;
    // The edit box clears the stage (Michał's call, same round as the copy
    // row's): the second layer folds away, because the row it is folded from
    // is about to become Save/Cancel - an open layer would hang over the box
    // with no press left to close it, and every line of it is dead during an
    // edit anyway (the senses disable, D34). Cancel does not bring it back:
    // one press of More does, with everything already fetched.
    unfold(false);
    editing = true;
    editor.value = toMeanings(bodyElement.textContent ?? "").join(MEANING_SEPARATOR);
    editor.hidden = false;
    bodyElement.hidden = true;
    sizeEditor();
    renderActions(["save", "cancel"]);
    place();
    // The keyboard the focus is about to summon arrives on its own schedule,
    // announced only by the visual viewport shrinking - which is what the
    // watcher waits for. `preventScroll`, because the browser's own idea of
    // revealing a focused box is to scroll the page under a bubble that is
    // pinned to the viewport; the watcher does the revealing deterministically
    // for both ways the bubble is pinned.
    watchKeyboard(true);
    editor.focus({ preventScroll: true });
    editor.select();
    keepEditorVisible();
  }

  /**
   * @param {boolean} keep whether what was typed becomes what is shown
   */
  function stopEditing(keep) {
    if (!editing || editor === null || bodyElement === null) return;
    if (keep) setBody(toMeanings(editor.value).join(MEANING_SEPARATOR));
    editing = false;
    watchKeyboard(false);
    editor.hidden = true;
    bodyElement.hidden = false;
    renderActions(restingActions);
    place();
  }

  /**
   * @param {(Action | "cancel")[]} actions
   */
  function renderActions(actions) {
    if (actionsElement === null) return;
    actionsElement.replaceChildren();
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset["action"] = action;
      if (action === "speak" || action === "copy") {
        // The labels that are pictures: the words go where a screen reader
        // and a hovering cursor read them, and the icons are built with DOM
        // calls like everything else here (see `speakerIcon`, `copyIcon`).
        const name = label(action);
        button.setAttribute("aria-label", name);
        button.title = name;
        button.append(action === "speak" ? speakerIcon() : copyIcon());
        // The copy icon is a disclosure: it says so, and keeps saying the
        // truth when the buttons are rebuilt over an open row.
        if (action === "copy") {
          button.setAttribute("aria-expanded", copyRowElement !== null && !copyRowElement.hidden ? "true" : "false");
        }
      } else {
        button.textContent = action === "more" && unfolded ? lessLabel() : label(action);
      }
      button.addEventListener("click", () => emit(action));
      actionsElement.append(button);
    }
    refreshControls();
  }

  /**
   * How much taller the bubble is going to get without being asked.
   *
   * A folded row is clipped to no height at all, so the bubble measures as if
   * it were not there - and by the time CSS unfolds it, there is nothing here
   * left to run. Measured rather than worked out from the variant, because a
   * recall bubble is folded only until somebody looks: once the row is out it
   * stays out, and a bubble placed again after that would otherwise have room
   * reserved for a row it is already showing.
   *
   * @returns {number}
   */
  function foldedHeight() {
    if (actionsElement === null || !folded()) return 0;
    return actionsElement.scrollHeight;
  }

  function place() {
    if (host === null || bubble === null) return;

    host.style.setProperty("visibility", "hidden", "important");
    host.style.setProperty("top", "0px", "important");
    bubble.style.left = "0px";
    // Every placement starts over from the stylesheet's own idea of the
    // second layer's height - a squeeze from the last placement must not
    // stick to a bubble that has since moved or lost its entries.
    if (entriesElement !== null) entriesElement.style.maxHeight = "";

    const viewport = {
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    };
    // The anchor where it stands on the screen at this moment. The stored rect
    // is of the moment the bubble was shown; the anchored mode lets the reader
    // scroll with the bubble open, and every choice below - which side, how
    // much room, how far the page still has to move (D97) - is a question
    // about the screen of right now, not of then. The viewport-pinned mode
    // keeps its anchor fresh another way: `follow` rewrites it on scroll.
    const scrolled = page === null ? { x: 0, y: 0 } : { x: window.scrollX, y: window.scrollY };
    const drift = page === null ? { x: 0, y: 0 } : { x: page.x - scrolled.x, y: page.y - scrolled.y };
    const spotAnchor = { top: anchor.top + drift.y, bottom: anchor.bottom + drift.y, left: anchor.left + drift.x };
    // Scrolling to make room is the anchored mode's privilege (D97): bubble
    // and phrase ride the same document there, so moving the page moves the
    // two together - on every other page the bubble is pinned to the viewport
    // and the page under it belongs to somebody else.
    const assist = page !== null;
    const kept = anchorLine > 0 ? Math.min(anchorLine, spotAnchor.bottom - spotAnchor.top) : spotAnchor.bottom - spotAnchor.top;
    // The stuck bar of right now (D138): panels grow it, other views drop it.
    const covered = Math.max(0, coveredAbove());

    let size = bubble.getBoundingClientRect();
    const folded = foldedHeight();

    // The second layer gives way before the bubble covers anything (D79): a
    // long dictionary entry would otherwise grow the bubble past the room
    // beside the phrase, and the fallback would put it over the very word it
    // is about. Squeezed to what the roomier side of the phrase can hold and
    // no further than readable - whatever still does not fit is the clamp's
    // business, as always. Where the page can be scrolled (D97), the room to
    // squeeze into is what the window can hold beside the phrase's first
    // line, wherever the phrase happens to stand right now.
    if (entriesElement !== null && !entriesElement.hidden) {
      const entriesHeight = entriesElement.clientHeight;
      if (entriesHeight > MIN_ENTRIES_HEIGHT) {
        const gap = onTouch ? SYSTEM_GAP : GAP;
        let room = Math.max(
          spotAnchor.top - gap - VIEWPORT_MARGIN - covered,
          viewport.height - VIEWPORT_MARGIN - (spotAnchor.bottom + gap),
        );
        if (assist) room = Math.max(room, viewport.height - covered - 2 * VIEWPORT_MARGIN - gap - kept);
        const overflow = Math.ceil(size.height + folded - room);
        if (overflow > 0) {
          entriesElement.style.maxHeight = `${Math.max(MIN_ENTRIES_HEIGHT, entriesHeight - overflow)}px`;
          size = bubble.getBoundingClientRect();
        }
      }
    }

    const spot = placement({ anchor: spotAnchor, size, viewport, folded, touch: onTouch, line: anchorLine, assist, covered });

    // The host marks the near edge's line; which way the bubble hangs off it
    // is the stylesheet's business, and it decides the layout too: the row
    // unfolds on the far side of the gloss, or the gloss would be pushed off
    // the line it was read on. Anchored, the same spot is written in the
    // coordinates of the document (the current scroll put back in), and the
    // scrolling page carries the bubble along by itself.
    placedOffset = { top: spot.top - spotAnchor.top, left: spot.left - spotAnchor.left };
    bubble.style.left = `${spot.left + scrolled.x}px`;
    bubble.dataset["grow"] = spot.grow;
    host.style.setProperty("top", `${spot.top + scrolled.y}px`, "important");
    host.style.setProperty("visibility", "visible", "important");

    // The page's part of the placement (D97): the bubble stands below the
    // phrase in the document already, and this is what brings the two onto
    // the screen together - the reason the page moves is that the reader just
    // asked for more bubble than the screen had room for.
    const ride = spot.scroll ?? 0;
    if (ride !== 0) {
      // Counted as performed (D138): the document's edge may clamp the ask,
      // and hide undoes only what actually happened.
      const before = window.scrollY;
      window.scrollBy(0, ride);
      carried += window.scrollY - before;
    }
    // A placement mid-edit answers to the keyboard too, whatever asked for it.
    if (editing) keepEditorVisible();
  }

  /**
   * @param {string} body
   * @param {Tone} [tone]
   */
  function setBody(body, tone = "normal") {
    if (bodyElement === null) return;
    bodyElement.textContent = body;
    bodyElement.dataset["tone"] = tone;
    // Repeated on the bubble, because the stylesheet lays an error bubble out
    // differently and a rule cannot look inward from the element it moves.
    if (bubble !== null) bubble.dataset["tone"] = tone;
    refreshControls();
  }

  function hideBubble() {
    if (host === null) return;
    watchKeyboard(false);
    settleCopy();
    // The page put back where the bubble found it (D138): the assist and the
    // keyboard reveals moved it to make room, and the reason leaves with the
    // bubble - without this, the line being read was left parked at the very
    // top of the window, under the reader's own bar, and closing the bubble
    // meant losing the place. Only the bubble's own scrolling is undone; a
    // reader who scrolled while it was open has said where they want to be.
    if (page !== null) {
      const back = settleBack({ shown: page.y, now: window.scrollY, carried });
      if (back !== 0) window.scrollBy(0, back);
    }
    carried = 0;
    host.remove();
    host = null;
    bubble = null;
    bodyElement = null;
    contextElement = null;
    contextTextElement = null;
    contextToggle = null;
    entriesElement = null;
    editor = null;
    actionsElement = null;
    copyRowElement = null;
    editing = false;
    unfolded = false;
    contextFolded = false;
    swallowClick = false;
    restingActions = [];
    phraseText = "";
    page = null;
    onHide?.();
  }

  return {
    show({
      anchor: rect,
      variant,
      body,
      tone = "normal",
      actions = [],
      touch = false,
      coarse = false,
      scale = 1,
      folded,
      anchored = false,
      line = 0,
      phrase = "",
    }) {
      build();
      anchor = rect;
      anchorLine = line;
      onTouch = touch;
      page = anchored ? { x: window.scrollX, y: window.scrollY } : null;
      // A bubble reused for a new phrase starts owing the page nothing: the
      // screen as it stands is the one this phrase was picked from, and hide
      // will settle back to it, not to the last phrase's (D138).
      carried = 0;
      editing = false;
      // The phrase this bubble stands over, held for the copy presses alone
      // (D110): never rendered - the bubble still does not repeat its phrase
      // (D23). The clipboard row itself starts put away: it was opened about
      // the last phrase.
      phraseText = phrase;
      settleCopy();
      if (copyRowElement !== null) copyRowElement.hidden = true;
      if (host !== null) {
        // Pinned to the document or to the viewport (see `page`), decided per
        // show: one bubble serves the reader and every other page.
        host.style.setProperty("position", page === null ? "fixed" : "absolute", "important");
      }
      if (bubble !== null) {
        bubble.dataset["variant"] = variant;
        // The touch size tier, granted by the gesture itself (D84) - see the
        // stylesheet, which also answers the media query on its own. Only
        // ever forced on: taken off, the media query speaks again.
        if (coarse) bubble.dataset["pointer"] = "coarse";
        else delete bubble.dataset["pointer"];
        // The settings knob (D85). A factor that is not a positive number has
        // said nothing and means "as designed" - the stylesheet's fallback.
        if (Number.isFinite(scale) && scale > 0 && scale !== 1) {
          bubble.style.setProperty("--bubble-scale", String(scale));
        } else {
          bubble.style.removeProperty("--bubble-scale");
        }
        // The bubble is reused from phrase to phrase, and a row left out was
        // out for the last one. The caller decides, and only the caller: it is
        // the one that knows the quiet-bubble setting (D81), and that setting
        // is a sentence about every bubble (D131). Said nothing, the row is
        // out - a bubble whose row is why it is open is the ordinary case, and
        // a variant that folded itself here would be a rule quietly outvoting
        // the reader's own (which is exactly what D131 came to fix: the recall
        // bubble folded itself, so half the settings had no effect on it).
        // A press that never became a click is cleared the same way: a finger
        // dragged back out of the bubble may not eat the next press.
        bubble.classList.toggle("revealed", folded !== true);
        swallowClick = false;
      }
      // Folded again: this is another phrase, and the sentence behind "More"
      // belonged to the last one. Set directly rather than through `unfold`,
      // which would render and place a bubble that has no body yet. The
      // sentence's own fold opens too (D96): clamping was a choice about the
      // last sentence, not about this one. The quiet bubble is the standing
      // exception (D121): it has no gloss and no More, so entries handed to
      // it later are the answer itself and show the moment they land.
      unfolded = variant === "quiet";
      contextFolded = false;
      if (contextElement !== null && contextTextElement !== null && contextToggle !== null) {
        contextTextElement.textContent = "";
        contextElement.hidden = true;
        contextToggle.hidden = true;
        contextToggle.style.visibility = "";
        applyContextFold();
      }
      if (entriesElement !== null) {
        entriesElement.replaceChildren();
        entriesElement.hidden = true;
      }
      if (editor !== null) editor.hidden = true;
      if (bodyElement !== null) bodyElement.hidden = false;
      setBody(body, tone);
      restingActions = actions;
      renderActions(actions);
      place();
    },

    setBody(body, tone = "normal") {
      setBody(body, tone);
      place();
    },

    setContext(sentence, tone = "normal") {
      setContext(sentence, tone);
      place();
    },

    setEntries(blocks) {
      setEntries(blocks);
      place();
    },

    setActions(actions) {
      restingActions = actions;
      // The clipboard row answered the buttons that opened it, and new
      // buttons are a new conversation (D110) - put away quietly, the
      // placement below measures the row's absence along with everything
      // else. It also keeps the row from standing with no icon left to
      // close it, which is what an error's empty row would otherwise do.
      settleCopy();
      if (copyRowElement !== null) copyRowElement.hidden = true;
      if (!editing) renderActions(actions);
      place();
    },

    follow(rect) {
      if (host === null || bubble === null) return;
      // The phrase moved (a scroll, D82); the bubble keeps its place beside
      // it - rigidly, by the offset of the last real placement, so nothing
      // flips sides or slides along the phrase mid-motion. The anchor is
      // updated too: whatever grows or re-places the bubble next starts
      // from where the phrase is, not where it was.
      anchor = rect;
      bubble.style.left = `${Math.round(rect.left + placedOffset.left)}px`;
      host.style.setProperty("top", `${Math.round(rect.top + placedOffset.top)}px`, "important");
      // Riding a scroll mid-edit could carry the box back under the software
      // keyboard, and the keyboard's own events have nothing to say about a
      // scroll of the page (D97).
      if (editing) keepEditorVisible();
    },

    reveal,

    hide: hideBubble,

    isOpen() {
      return host !== null;
    },

    isEditing() {
      return editing;
    },

    escape() {
      // One key, one step outward each press: leave the edit box first, put
      // the clipboard row away second, close the bubble only when there is
      // nothing left to leave - the ladder every Escape in the reader keeps.
      if (editing) stopEditing(false);
      else if (copyRowElement !== null && !copyRowElement.hidden) hideCopyRow();
      else hideBubble();
    },

    owns(target) {
      // The shadow root is closed, so every event coming out of the bubble is
      // retargeted to the host: comparing against it is enough.
      return host !== null && target === host;
    },
  };
}
