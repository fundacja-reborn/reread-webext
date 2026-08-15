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
 * It comes in two variants, and they are one column told apart by nothing but
 * its starting state (D44). A phrase already kept is a question - what was
 * this again - so `recall` opens folded to one line, and the row of actions
 * unfolds only when somebody arrives inside the bubble, with a cursor, with a
 * press or with the keyboard. A fresh selection is the other way round: what
 * to do with it is the whole of why the bubble is open, so `save` opens with
 * the row already out.
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
 * @param {Action | "cancel"} action
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
    case "speak":
      return t("bubble_speak");
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

/** The one button whose label changes with what it will do. */
function lessLabel() {
  return t("bubble_less");
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
  /* The launcher has nothing to say above its one button, and an empty line
     would still cost the row of pixels its line-height reserves. */
  .body:empty { display: none; }

  /* Quieter than the gloss and fenced off from the rest: this is the sentence
     the phrase was in, not another meaning of it. Style and colour go on every
     edge but width on one, so that the mirror below can move the line to the
     other side by widths alone and the colour stays one rule per theme. */
  .context {
    margin-top: 8px;
    padding-top: 8px;
    border: 0 solid var(--edge);
    border-top-width: 1px;
    font-size: calc(var(--type-second) * var(--bubble-scale, 1));
    opacity: 0.85;
  }

  /* The same tones the body knows, for the one bubble that fetches its second
     layer on demand: a recalled phrase answers from the database, and the
     sentence starts being translated only when More asks for it. */
  .context[data-tone="pending"] { opacity: 0.6; font-style: italic; }
  .context[data-tone="error"] { color: #a3341f; }

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
     text being squeezed. Folded is where every bubble starts, and the whole of
     the difference between the variants (D44) is when they leave: "recall"
     waits for somebody to come looking, everything else opens with the
     revealed class already on (see show), and the fold is never seen. */
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

  /* The launcher is its one button and nothing else, so the row's padding -
     which exists to stand the row off a gloss that is not there - goes too.
     After the mirror, whose padding this outranks by standing below it. */
  .bubble[data-variant="launcher"] .actions { padding: 0; }

  /* An error bubble is not a translation, and it drops the mirror's rule for
     the same reason the mirror exists: the near edge belongs to the eye's way
     back, and when the bubble is an apology with one way out, the way out is
     what should lie on it. The order moves only the row of actions - a recall
     bubble whose save failed keeps its second layer where the mirror put it,
     borders and all. */
  .bubble[data-tone="error"][data-grow="up"] .reveal { order: -1; }
  .bubble[data-tone="error"][data-grow="up"] .actions { padding: 8px 0 2px; }

  /* The signature, and only on errors. A translation needs none - the answer
     is the point, and a header would cost the line D23 saved - but an error
     may be the first thing this extension ever shows somebody, and an
     unsigned complaint floating over a page reads as the page's own. */
  .brand {
    display: none;
    font-size: calc(11px * var(--bubble-scale, 1));
    font-weight: 600;
    letter-spacing: 0.03em;
    opacity: 0.6;
    margin-bottom: 4px;
  }
  .bubble[data-tone="error"] .brand { display: block; }
  /* A signature signs at the top, also when the mirror reverses the column. */
  .bubble[data-tone="error"][data-grow="up"] .brand { order: 1; }

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

  /* The speaker is the row's one picture (D83): universally readable where a
     "Read aloud" label would push the row past one line on a phone, and an
     honest signal that it acts on the phrase itself, not on the vocabulary.
     Inline-flex centers the icon in the same box the text labels get, and the
     icon matches their cap height, so the row keeps one baseline rhythm. */
  .actions button[data-action="speak"] {
    display: inline-flex;
    align-items: center;
  }
  .actions button[data-action="speak"] svg {
    width: var(--icon);
    height: var(--icon);
    display: block;
  }

  /* The exception, and the only real call to action a bubble has: Save is the
     press that keeps a phrase which would otherwise be gone, the launcher's one
     button is the whole of the bubble it is in, and Settings is the one thing
     an error bubble can offer - none of the three ever shares a screen with
     another, so none outshouts the rest. */
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
    .context[data-tone="error"] { color: #f0a83c; }
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

/** @typedef {"normal" | "pending" | "error"} Tone */
/** Which of the three bubbles this is. `launcher` is reader-only mode's one
 *  offer: no gloss, one button. @typedef {"recall" | "save" | "launcher"} Variant */
/** What the bubble can offer. `speak` is the row's one picture - a speaker
 *  icon that reads the phrase aloud (D83).
 *  @typedef {"save" | "learned" | "edit" | "settings" | "more" | "reader" | "speak"} Action */
/** What it reports - editing never leaves the bubble, and More leaves it only
 *  on the press that opens the layer, so a caller with nothing fetched yet can
 *  fetch it then. @typedef {"save" | "choose" | "learned" | "settings" | "reader" | "more" | "speak"} ReportedAction */

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
 * `folded` overrides the variant's own rule for where the row of actions
 * starts (D44): with the quiet-bubble setting on (D81) even a fresh
 * selection opens with the row away, because the phrase mostly keeps itself
 * and the buttons are an aside - `reveal()` is the caller's way to bring the
 * row out after all when one of them turns out to be the point (Save, an
 * error's way to settings).
 *
 * `anchored` pins the bubble to the page rather than to the viewport: the
 * host goes `absolute` at the document coordinates the anchor had when shown,
 * so scrolling carries the bubble with the phrase it is about - the reader
 * page's mode, where the bubble is a margin note, not a popup. Placement is
 * still figured against the viewport of the moment it was shown; later
 * growth re-places against that same frozen frame, because the phrase has
 * not moved in the document and the bubble may not wander from it.
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
 * @typedef {object} Tooltip
 * @property {(options: { anchor: DOMRect, variant: Variant, body: string, tone?: Tone, actions?: Action[], touch?: boolean, coarse?: boolean, scale?: number, folded?: boolean, anchored?: boolean }) => void} show
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
 * @param {object} where
 * @param {{ top: number, bottom: number, left: number }} where.anchor the phrase, in viewport coordinates
 * @param {{ width: number, height: number }} where.size what the bubble measures now
 * @param {{ width: number, height: number }} where.viewport
 * @param {number} [where.folded] how much taller it is still going to get on its own
 * @param {boolean} [where.touch] whether the selection was made by touch
 * @returns {{ left: number, top: number, grow: "down" | "up" }}
 */
export function placement({ anchor, size, viewport, folded = 0, touch = false }) {
  // The room to look for is the room the bubble may come to need, not the room
  // it needs now - a folded row unfolds with nobody left to move anything.
  const height = size.height + folded;

  const maxLeft = Math.max(VIEWPORT_MARGIN, viewport.width - size.width - VIEWPORT_MARGIN);
  const left = Math.round(Math.min(Math.max(VIEWPORT_MARGIN, anchor.left), maxLeft));

  const gap = touch ? SYSTEM_GAP : GAP;

  if (anchor.top - gap - height >= VIEWPORT_MARGIN) {
    return { left, top: Math.round(anchor.top - gap), grow: "up" };
  }

  // Below it, and pushed up only by the bottom of the window: the most of it
  // that can be on the screen is on the screen, even over the phrase.
  const below = anchor.bottom + gap;
  const room = viewport.height - VIEWPORT_MARGIN - height;
  return { left, top: Math.round(Math.max(VIEWPORT_MARGIN, Math.min(below, room))), grow: "down" };
}

/**
 * @param {object} options
 * @param {(action: ReportedAction, meanings: string[]) => void} options.onAction what the reader pressed, and what the bubble was showing when they did
 * @param {() => void} [options.onHide] told as the bubble leaves the screen,
 *   whichever door it left by - the caller's chance to stop what only made
 *   sense while it was up (a phrase being read aloud, D83)
 * @returns {Tooltip}
 */
export function createTooltip({ onAction, onHide }) {
  /** @type {HTMLDivElement | null} */
  let host = null;
  /** @type {HTMLDivElement | null} */
  let bubble = null;
  /** @type {HTMLDivElement | null} */
  let bodyElement = null;
  /** @type {HTMLDivElement | null} */
  let contextElement = null;
  /** @type {HTMLDivElement | null} */
  let entriesElement = null;
  /** @type {HTMLTextAreaElement | null} */
  let editor = null;
  /** @type {HTMLDivElement | null} */
  let actionsElement = null;

  /** Where the bubble is anchored, so it can be placed again when it changes size. */
  let anchor = new DOMRect();
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
  let editing = false;
  /** Whether the second layer is unfolded. Folded again for every new phrase. */
  let unfolded = false;
  /** Whether the click the last press becomes is the one that unfolded the row. */
  let swallowClick = false;
  /** What the buttons were before the edit box opened, to go back to on cancel. */
  /** @type {Action[]} */
  let restingActions = [];

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

    // Pressing a button must not take the selection away: the page's own
    // selection is what the bubble is about, and it disappearing under the
    // cursor reads as the extension breaking the page. The dictionary entries
    // are in this for the same reason now that a line of one can be pressed -
    // the bubble deliberately does not repeat the phrase it is about (D23), so
    // the selection is the only thing on the screen still saying which word all
    // of this is an answer to. The price is that text in there cannot be
    // selected with the mouse, which nothing in the bubble is for.
    for (const element of [actionsElement, entriesElement]) {
      element.addEventListener("mousedown", (event) => event.preventDefault());
    }
    editor.addEventListener("input", refreshControls);
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
    // edits it, then the actions, then the second layer. The signature stands
    // before them all and outside the order: only the error tone shows it
    // (see .brand).
    bubble.append(brandElement, bodyElement, editor, revealElement, contextElement, entriesElement);
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
   * @param {Action | "cancel" | "choose"} action
   */
  function emit(action) {
    // Editing is the bubble's own business: nobody outside needs to know that a
    // text box opened, only what it said when the reader was done with it.
    if (action === "cancel") {
      stopEditing(false);
      return;
    }
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
    contextElement.hidden = !unfolded || (contextElement.textContent ?? "").length === 0;
    entriesElement.hidden = !unfolded || entriesElement.childElementCount === 0;
    renderActions(editing ? ["save", "cancel"] : restingActions);
    place();
    // Asked after `place`, because a hidden element has no size to compare and
    // the bubble is only its final height once it has been positioned.
    entriesElement.dataset["more"] =
      !entriesElement.hidden && entriesElement.scrollHeight > entriesElement.clientHeight + 1 ? "true" : "false";
  }

  /**
   * @param {string | null} sentence
   * @param {Tone} [tone]
   */
  function setContext(sentence, tone = "normal") {
    if (contextElement === null) return;
    contextElement.textContent = sentence ?? "";
    contextElement.dataset["tone"] = tone;
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

      for (const line of block.lines) {
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

  function startEditing() {
    if (editor === null || bodyElement === null) return;
    editing = true;
    editor.value = toMeanings(bodyElement.textContent ?? "").join(MEANING_SEPARATOR);
    editor.rows = Math.min(6, Math.max(1, editor.value.split(MEANING_SEPARATOR).length));
    editor.hidden = false;
    bodyElement.hidden = true;
    renderActions(["save", "cancel"]);
    place();
    editor.focus();
    editor.select();
  }

  /**
   * @param {boolean} keep whether what was typed becomes what is shown
   */
  function stopEditing(keep) {
    if (!editing || editor === null || bodyElement === null) return;
    if (keep) setBody(toMeanings(editor.value).join(MEANING_SEPARATOR));
    editing = false;
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
      if (action === "speak") {
        // The one label that is a picture: the words go where a screen reader
        // and a hovering cursor read them, and the icon is built with DOM
        // calls like everything else here (see `speakerIcon`).
        const name = label(action);
        button.setAttribute("aria-label", name);
        button.title = name;
        button.append(speakerIcon());
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
    let size = bubble.getBoundingClientRect();
    const folded = foldedHeight();

    // The second layer gives way before the bubble covers anything (D79): a
    // long dictionary entry would otherwise grow the bubble past the room
    // beside the phrase, and the fallback would put it over the very word it
    // is about. Squeezed to what the roomier side of the phrase can hold and
    // no further than readable - whatever still does not fit is the clamp's
    // business, as always.
    if (entriesElement !== null && !entriesElement.hidden) {
      const entriesHeight = entriesElement.clientHeight;
      if (entriesHeight > MIN_ENTRIES_HEIGHT) {
        const gap = onTouch ? SYSTEM_GAP : GAP;
        const room = Math.max(
          anchor.top - gap - VIEWPORT_MARGIN,
          viewport.height - VIEWPORT_MARGIN - (anchor.bottom + gap),
        );
        const overflow = Math.ceil(size.height + folded - room);
        if (overflow > 0) {
          entriesElement.style.maxHeight = `${Math.max(MIN_ENTRIES_HEIGHT, entriesHeight - overflow)}px`;
          size = bubble.getBoundingClientRect();
        }
      }
    }

    const spot = placement({ anchor, size, viewport, folded, touch: onTouch });

    // The host marks the near edge's line; which way the bubble hangs off it
    // is the stylesheet's business, and it decides the layout too: the row
    // unfolds on the far side of the gloss, or the gloss would be pushed off
    // the line it was read on. Anchored, the same spot is written in the
    // coordinates of the document (see `page`), and the scrolling page
    // carries the bubble along by itself.
    const offset = page ?? { x: 0, y: 0 };
    placedOffset = { top: spot.top - anchor.top, left: spot.left - anchor.left };
    bubble.style.left = `${spot.left + offset.x}px`;
    bubble.dataset["grow"] = spot.grow;
    host.style.setProperty("top", `${spot.top + offset.y}px`, "important");
    host.style.setProperty("visibility", "visible", "important");
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
    host.remove();
    host = null;
    bubble = null;
    bodyElement = null;
    contextElement = null;
    entriesElement = null;
    editor = null;
    actionsElement = null;
    editing = false;
    unfolded = false;
    swallowClick = false;
    restingActions = [];
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
    }) {
      build();
      anchor = rect;
      onTouch = touch;
      page = anchored ? { x: window.scrollX, y: window.scrollY } : null;
      editing = false;
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
        // out for the last one. Only recall starts folded: everywhere else the
        // row is why the bubble is open, so it starts revealed (D44) - unless
        // the caller says otherwise (`folded`: the quiet-bubble setting, D81).
        // A press that never became a click is cleared the same way: a finger
        // dragged back out of the bubble may not eat the next press.
        bubble.classList.toggle("revealed", folded === undefined ? variant !== "recall" : !folded);
        swallowClick = false;
      }
      // Folded again: this is another phrase, and the sentence behind "More"
      // belonged to the last one. Set directly rather than through `unfold`,
      // which would render and place a bubble that has no body yet.
      unfolded = false;
      if (contextElement !== null) {
        contextElement.textContent = "";
        contextElement.hidden = true;
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
      // One key, two meanings: leave the edit box first, close the bubble only
      // when there is nothing left to leave.
      if (editing) stopEditing(false);
      else hideBubble();
    },

    owns(target) {
      // The shadow root is closed, so every event coming out of the bubble is
      // retargeted to the host: comparing against it is enough.
      return host !== null && target === host;
    },
  };
}
