<script setup>
import { computed } from "vue";
import { ClipboardCheck, Wrench, Check } from "lucide-vue-next";
import SignaturePad from "./SignaturePad.vue";
const props = defineProps({ modelValue: Object, role: String });
const emit = defineEmits(["update:modelValue"]);
const complete = computed(() =>
  ["notes", "name", "certificate", "date"].every((k) =>
    props.modelValue[k].trim(),
  ),
);
function update(field, value) {
  emit("update:modelValue", { ...props.modelValue, [field]: value });
}
</script>

<template>
  <section class="statement-card">
    <div class="statement-title">
      <span class="statement-icon"
        ><ClipboardCheck v-if="role === 'inspector'" :size="21" /><Wrench
          v-else
          :size="21"
      /></span>
      <div>
        <span class="eyebrow">{{
          role === "inspector" ? "INSPECTION" : "TREATMENT"
        }}</span>
        <h2>
          {{
            role === "inspector"
              ? "Inspector’s statement"
              : "Control technician’s statement"
          }}
        </h2>
      </div>
      <span v-if="complete" class="complete-badge"
        ><Check :size="14" /> Complete</span
      >
    </div>
    <label class="field"
      ><span>{{
        role === "inspector" ? "Inspection notes" : "Control notes"
      }}</span
      ><textarea
        :value="modelValue.notes"
        rows="9"
        maxlength="4000"
        :placeholder="
          role === 'inspector'
            ? 'Record findings, inspected areas, access limitations, and observations…'
            : 'Record work performed, treated areas, materials, and follow-up notes…'
        "
        @input="update('notes', $event.target.value)"
      ></textarea
      ><small
        >{{ modelValue.notes.length.toLocaleString() }} / 4,000 characters ·
        Long notes continue on an additional sheet.</small
      ></label
    >
    <label class="field"
      ><span>Signed name</span
      ><input
        :value="modelValue.name"
        maxlength="120"
        autocomplete="name"
        placeholder="Technician’s full name"
        @input="update('name', $event.target.value)"
    /></label>
    <div class="field-pair">
      <label class="field"
        ><span>Certification #</span
        ><input
          :value="modelValue.certificate"
          maxlength="60"
          placeholder="Certification number"
          @input="update('certificate', $event.target.value)" /></label
      ><label class="field"
        ><span>Date</span
        ><input
          type="date"
          :value="modelValue.date"
          @input="update('date', $event.target.value)"
      /></label>
    </div>
    <SignaturePad
      :model-value="modelValue.signature"
      :label="
        role === 'inspector'
          ? 'Inspector signature'
          : 'Control technician signature'
      "
      @update:model-value="update('signature', $event)"
    />
  </section>
</template>
