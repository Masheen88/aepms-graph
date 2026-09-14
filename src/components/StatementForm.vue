<script setup>
import { computed, ref } from "vue";
import { ClipboardCheck, Wrench, Check, Save, Sparkles } from "lucide-vue-next";
import SignaturePad from "./SignaturePad.vue";

const props = defineProps({
  modelValue: Object,
  role: String,
  credentialProfiles: { type: Array, default: () => [] },
  noteTemplates: { type: Array, default: () => [] },
});
const emit = defineEmits([
  "update:modelValue",
  "save-credentials",
  "save-note-template",
  "apply-credential",
]);
const selectedCredential = ref("");
const selectedTemplate = ref("");
const complete = computed(() =>
  ["notes", "name", "certificate", "date"].every((k) =>
    props.modelValue[k].trim(),
  ),
);
const usableTemplates = computed(() =>
  props.noteTemplates.filter(
    (template) => !template.role || template.role === "both" || template.role === props.role,
  ),
);

function update(field, value) {
  emit("update:modelValue", { ...props.modelValue, [field]: value });
}
function applyCredential() {
  if (!selectedCredential.value) return;
  emit("apply-credential", { role: props.role, id: selectedCredential.value });
}
function applyTemplate() {
  const template = usableTemplates.value.find((entry) => entry.id === selectedTemplate.value);
  if (!template) return;
  const current = props.modelValue.notes.trim();
  update("notes", current ? `${current}\n\n${template.text}` : template.text);
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
        <small class="statement-optional">Optional — save and PDF export work without this section.</small>
      </div>
      <span v-if="complete" class="complete-badge"
        ><Check :size="14" /> Complete</span
      >
    </div>

    <div class="statement-preset-row">
      <label class="field compact-field">
        <span>Saved technician</span>
        <select v-model="selectedCredential">
          <option value="">Choose saved credentials…</option>
          <option v-for="profile in credentialProfiles" :key="profile.id" :value="profile.id">
            {{ profile.title }}
          </option>
        </select>
      </label>
      <button
        type="button"
        class="btn btn-secondary"
        :disabled="!selectedCredential"
        @click="applyCredential"
      >
        Use
      </button>
      <button
        type="button"
        class="btn btn-secondary"
        @click="emit('save-credentials', role)"
      >
        <Save :size="15" /> Save current
      </button>
    </div>

    <label class="field"
      ><span>{{
        role === "inspector" ? "Inspection notes" : "Control notes"
      }}</span>
      <div class="note-template-row">
        <select v-model="selectedTemplate" aria-label="Saved note template">
          <option value="">Insert a note template…</option>
          <option v-for="template in usableTemplates" :key="template.id" :value="template.id">
            {{ template.title }}
          </option>
        </select>
        <button
          type="button"
          class="btn btn-secondary"
          :disabled="!selectedTemplate"
          @click="applyTemplate"
        >
          <Sparkles :size="15" /> Insert
        </button>
        <button
          type="button"
          class="text-button"
          :disabled="!modelValue.notes.trim()"
          @click="emit('save-note-template', role)"
        >
          Save note as template
        </button>
      </div>
      <textarea
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
