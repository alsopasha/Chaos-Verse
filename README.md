# Chaos Verse

Chaos Verse trains a small character model on a four line poem in the browser. The model is implemented directly in TypeScript and runs inside a Web Worker, leaving React and the canvas free to render.

[chaosverse.live](https://chaosverse.live)

## The model

The input is a window of fourteen characters, represented as one hot vectors over the poem's alphabet. It feeds a hidden layer of 48 ReLU units and a softmax output over the same alphabet. The weight matrices use Xavier initialisation.

Every training step predicts the character following the current window and applies SGD with a learning rate of `0.015`. The worker completes eighty steps per tick. Loss on the display is an exponential moving average of the negative log likelihood.

Every fourth tick, the model generates a complete passage by repeatedly choosing its most likely next character.

## Disturbing the network

The canvas shows a sample of the input, hidden, and output units. Visible connections come from the current weight matrices: cyan for positive weights, brick for negative ones, with low magnitude links omitted.

Dragging a node does more than move the diagram. Total node displacement is converted into a severity value and sent to the worker. That value controls the probability and size of random changes to the weights, which are clamped to the range `[-2, 2]`. The disturbance also raises the displayed loss immediately. The generated poem deteriorates and normal training begins repairing the model.

The displayed glitch strength follows both the visible displacement and the current loss. This keeps the typography tied to the model state rather than using an unrelated visual effect.

## Implementation

React manages the interface, Canvas 2D draws the network, and `src/engine/worker.ts` contains the model, training loop, generation, and weight disturbance.
