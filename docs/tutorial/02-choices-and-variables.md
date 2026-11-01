# 2. Choices and variables

## A menu

```
menu:
  "Yes, show me around.":
    set curious += 1
    jump tour

  "Just a quiet corner, please.":
    iris: Back by the window, then. Nobody will bother you.
    jump window_seat
```

Each option is a quoted line ending in `:` with an indented body. `jump <label>` continues at a label; labels are global
across all scripts. Add `"prompt text"` after `menu` to show a line above the choices.

## Variables and conditions

Top-level `set` lines run once before the story starts, so that is where variables get their first value:

```
set curious = 0
set pages = 0
```

`set` takes `=`, `+=`, `-=`, `*=` and `/=`. Use a variable in text with square brackets and branch with `if`:

```
iris: You have turned [pages] pages already.
if curious >= 1:
  iris: Since you asked for the tour, you get the good chair.
else:
  iris: I'll bring you a blanket.
```

`[n:page|pages]` picks a plural form, and `[n:2]` shows two decimals.

## Asking for text

```
input name "Before we go on, what should I call you?" default="Reader" max=16
iris: Nice to meet you, [name].
```

The answer is stored in `name`. Give variables you read in other branches a `set` at the top, so a player who skipped
the question still has a value (the demo sets `name = "friend"`).

## Lists

`script/rooms.vn` keeps a bag:

```
set bag = []
set bag += "key"
if contains(bag, "key"):
  iris: You have the key.
iris: You carry: [bag].
```

`define item key "Brass key"` gives list entries display names. Also available: `count`, `item`, `index`, and `pick(list)`
for a random element. Random results are seeded, so loading or rolling back replays the same outcome.

Next: [staging and effects](03-staging-and-effects.md).
