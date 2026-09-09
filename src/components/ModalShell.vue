<script setup>
import { onBeforeUnmount, onMounted, ref } from "vue";
import { X } from "lucide-vue-next";
defineProps({ title: String, wide: Boolean });
const emit = defineEmits(["close"]);
const dialog = ref(null);
onMounted(() => dialog.value.showModal());
onBeforeUnmount(() => dialog.value?.close());
</script>
<template>
  <dialog
    ref="dialog"
    class="modal"
    :class="{ 'modal-wide': wide }"
    aria-labelledby="modal-title"
    @cancel.prevent="emit('close')"
    @click="
      (e) => {
        if (e.target === dialog) emit('close');
      }
    "
  >
    <div class="modal-header">
      <h2 id="modal-title">{{ title }}</h2>
      <button
        class="icon-button"
        aria-label="Close dialog"
        @click="emit('close')"
      >
        <X :size="20" />
      </button>
    </div>
    <div class="modal-body"><slot /></div>
  </dialog>
</template>
