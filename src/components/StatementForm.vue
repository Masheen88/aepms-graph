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
const hasSignoff = computed(() =>
  Boolean(
    props.modelValue.name?.trim() ||
    props.modelValue.certificate?.trim() ||
    props.modelValue.date?.trim() ||
    props.modelValue.signature?.length,
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
        <span class="eyebrow">{{ role === "inspector" ? "INSPECTION" : "TREATMENT" }}</span>
        <h2>{{ role === "inspector" ? "Inspector’s statement" : "Control technician’s statement" }}</h2>
      </div>
      <span v-if="complete" class="complete-badge"><Check :size="14" /> Complete</span>
    </div>

    <div class="statement-note-block">
      <div class="statement-subheading">
        <span><strong>{{ role === "inspector" ? "Field notes" : "Treatment notes" }}</strong></span>
        <small>{{ modelValue.notes.length.toLocaleString() }} / 4,000</small>
      </div>
      <textarea
        :value="modelValue.notes"
        rows="7"
        maxlength="4000"
        :placeholder="
          role === 'inspector'
            ? 'Record findings, inspected areas, access limitations, and observations…'
            : 'Record work performed, treated areas, materials, and follow-up notes…'
        "
        @input="update('notes', $event.target.value)"
      ></textarea>
      <details class="statement-tools note-shortcuts">
        <summary>Note shortcuts</summary>
        <div class="note-template-inline">
          <select v-model="selectedTemplate" aria-label="Saved note template">
            <option value="">Saved note…</option>
            <option v-for="template in usableTemplates" :key="template.id" :value="template.id">
              {{ template.title }}
            </option>
          </select>
          <button type="button" class="btn btn-secondary" :disabled="!selectedTemplate" @click="applyTemplate">
            <Sparkles :size="15" /> Insert
          </button>
          <button
            type="button"
            class="text-button note-save-template"
            :disabled="!modelValue.notes.trim()"
            @click="emit('save-note-template', role)"
          >
            Save note
          </button>
        </div>
      </details>
    </div>

    <details class="statement-tools">
      <summary>Technician preset</summary>
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
        <button type="button" class="btn btn-secondary" :disabled="!selectedCredential" @click="applyCredential">Use</button>
        <button type="button" class="btn btn-secondary" @click="emit('save-credentials', role)">
          <Save :size="15" /> Save current
        </button>
      </div>
    </details>

    <details class="statement-signoff statement-signoff-details" :open="hasSignoff">
      <summary>Sign-off <small>{{ hasSignoff ? 'Started' : 'Optional' }}</small></summary>
      <label class="field">
        <span>Signed name</span>
        <input
          :value="modelValue.name"
          maxlength="120"
          autocomplete="name"
          placeholder="Technician’s full name"
          @input="update('name', $event.target.value)"
        />
      </label>
      <div class="field-pair">
        <label class="field">
          <span>Certification #</span>
          <input
            :value="modelValue.certificate"
            maxlength="60"
            placeholder="Certification number"
            @input="update('certificate', $event.target.value)"
          />
        </label>
        <label class="field">
          <span>Date</span>
          <input type="date" :value="modelValue.date" @input="update('date', $event.target.value)" />
        </label>
      </div>
      <SignaturePad
        :model-value="modelValue.signature"
        :label="role === 'inspector' ? 'Inspector signature' : 'Control technician signature'"
        @update:model-value="update('signature', $event)"
      />
    </details>
  </section>
</template>
