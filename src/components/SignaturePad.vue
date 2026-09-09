<script setup>
import { ref } from "vue";
import { Eraser } from "lucide-vue-next";
const props = defineProps({ modelValue: Array, label: String });
const emit = defineEmits(["update:modelValue"]);
const current = ref(null);
let pointer = null;
function point(event) {
  const r = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(400, ((event.clientX - r.left) / r.width) * 400)),
    y: Math.max(0, Math.min(100, ((event.clientY - r.top) / r.height) * 100)),
  };
}
function start(event) {
  if (pointer !== null) return;
  pointer = event.pointerId;
  event.currentTarget.setPointerCapture(pointer);
  current.value = [point(event)];
}
function move(event) {
  if (pointer !== event.pointerId || !current.value) return;
  if (current.value.length < 1500) current.value.push(point(event));
}
function end(event) {
  if (pointer !== event.pointerId) return;
  if (current.value?.length > 1 && props.modelValue.length < 40)
    emit("update:modelValue", [...props.modelValue, current.value]);
  current.value = null;
  pointer = null;
}
function cancel() {
  current.value = null;
  pointer = null;
}
</script>

<template>
  <div class="signature-pad">
    <div class="signature-heading">
      <span>{{ label || "Draw signature" }} <small>(optional)</small></span
      ><button
        type="button"
        class="text-button"
        @click="emit('update:modelValue', [])"
      >
        <Eraser :size="14" /> Clear
      </button>
    </div>
    <svg
      viewBox="0 0 400 100"
      preserveAspectRatio="none"
      role="img"
      :aria-label="label || 'Draw an optional signature here'"
      @pointerdown.prevent="start"
      @pointermove.prevent="move"
      @pointerup="end"
      @pointercancel="cancel"
    >
      <line
        x1="12"
        y1="82"
        x2="388"
        y2="82"
        stroke="#ccd7db"
        stroke-dasharray="3 3"
      />
      <path
        v-for="(stroke, index) in [
          ...modelValue,
          ...(current ? [current] : []),
        ]"
        :key="index"
        :d="stroke.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ')"
        stroke="#183b42"
        stroke-width="2"
        fill="none"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </div>
</template>
