<template>
  <div>
    <v-row align="center" class="mb-4">
      <v-col>
        <h1 class="text-h4">Documents</h1>
      </v-col>
      <v-col cols="auto">
        <v-btn 
          color="primary" 
          prepend-icon="mdi-upload"
          @click="showUploadDialog = true"
        >
          Upload Document
        </v-btn>
        <v-btn 
          class="ml-2"
          color="secondary"
          variant="tonal"
          prepend-icon="mdi-cloud-upload"
          @click="openChunkUpload"
        >
          Chunk Upload (Test)
        </v-btn>
      </v-col>
    </v-row>

    <!-- Search and Filters -->
    <v-card class="mb-4">
      <v-card-text>
        <v-row>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="searchQuery"
              label="Search documents..."
              prepend-inner-icon="mdi-magnify"
              variant="outlined"
              density="compact"
              clearable
              @update:model-value="debouncedSearch"
            ></v-text-field>
          </v-col>
          <v-col cols="12" md="3">
            <v-select
              v-model="filterType"
              label="Document Type"
              :items="documentTypes"
              variant="outlined"
              density="compact"
              clearable
            ></v-select>
          </v-col>
          <v-col cols="12" md="3">
            <v-select
              v-model="sortBy"
              label="Sort By"
              :items="sortOptions"
              variant="outlined"
              density="compact"
            ></v-select>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- Documents List/Grid Toggle -->
    <v-row align="center" class="mb-2">
      <v-col>
        <v-chip-group v-model="selectedTags" multiple filter>
          <v-chip v-for="tag in availableTags" :key="tag">
            {{ tag }}
          </v-chip>
        </v-chip-group>
      </v-col>
      <v-col cols="auto">
        <v-btn-toggle v-model="viewMode" mandatory>
          <v-btn icon="mdi-view-list" value="list"></v-btn>
          <v-btn icon="mdi-view-grid" value="grid"></v-btn>
        </v-btn-toggle>
      </v-col>
    </v-row>

    <!-- Loading State -->
    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4"></v-progress-linear>

    <!-- Documents List View -->
    <v-card v-if="viewMode === 'list' && !loading">
      <v-data-table
        :headers="headers"
        :items="documents"
        :items-per-page="itemsPerPage"
        :loading="loading"
        @update:items-per-page="itemsPerPage = $event"
      >
        <template v-slot:item.name="{ item }">
          <div class="d-flex align-center">
            <v-icon class="mr-2">{{ getFileIcon(item.type) }}</v-icon>
            {{ item.name }}
          </div>
        </template>
        <template v-slot:item.size="{ item }">
          {{ formatBytes(item.size) }}
        </template>
        <template v-slot:item.createdAt="{ item }">
          {{ formatDate(item.createdAt) }}
        </template>
        <template v-slot:item.tags="{ item }">
          <v-chip v-for="tag in item.tags" :key="tag" size="small" class="mr-1">
            {{ tag }}
          </v-chip>
        </template>
        <template v-slot:item.actions="{ item }">
          <v-btn icon="mdi-eye" size="small" variant="text" @click="viewDocument(item)"></v-btn>
          <v-btn icon="mdi-download" size="small" variant="text" @click="downloadDocument(item)"></v-btn>
        <v-btn icon="mdi-delete" size="small" variant="text" color="error" @click="deleteDocument(item)"></v-btn>
        </template>
      </v-data-table>
    </v-card>

    <!-- Documents Grid View -->
    <v-row v-if="viewMode === 'grid' && !loading">
      <v-col v-for="gridDoc in documents" :key="gridDoc.id" cols="12" sm="6" md="4" lg="3">
        <v-card>
          <v-card-text class="text-center pa-4">
            <v-icon size="64" :color="getFileColor(gridDoc.type)">
              {{ getFileIcon(gridDoc.type) }}
            </v-icon>
            <div class="text-h6 mt-2">{{ gridDoc.name }}</div>
            <div class="text-caption text-grey">{{ formatBytes(gridDoc.size) }}</div>
            <div class="text-caption">{{ formatDate(gridDoc.createdAt) }}</div>
            <div class="mt-2">
              <v-chip v-for="tag in gridDoc.tags" :key="tag" size="small" class="mr-1">
                {{ tag }}
              </v-chip>
            </div>
          </v-card-text>
          <v-card-actions>
            <v-btn variant="text" size="small" @click="viewDocument(gridDoc)">View</v-btn>
            <v-spacer></v-spacer>
            <v-btn icon="mdi-download" size="small" @click="downloadDocument(gridDoc)"></v-btn>
            <v-btn icon="mdi-delete" size="small" color="error" @click="deleteDocument(gridDoc)"></v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>

    <!-- Upload Dialog -->
    <v-dialog v-model="showUploadDialog" max-width="600">
      <DocumentUpload @close="showUploadDialog = false" @uploaded="onDocumentUploaded" />
    </v-dialog>

    <!-- Document Preview Dialog -->
    <v-dialog v-model="showPreviewDialog" max-width="900">
      <DocumentPreview :document="selectedDocument" @close="showPreviewDialog = false" />
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, inject, watch } from 'vue'
import { debounce } from 'lodash-es'
import DocumentUpload from '../components/DocumentUpload.vue'
import DocumentPreview from '../components/DocumentPreview.vue'
import { listPipeDocs, deletePipeDoc } from '../services/repositoryClient'
import { createClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import { NodeUploadService } from '@ai-pipestream/grpc-stubs/dist/repository/filesystem/upload/upload_service_pb'

const props = defineProps<{
  initialSearch?: string
}>()

const emit = defineEmits(['search-update'])

// Inject notification
const showNotification = inject('showNotification') as Function

// State
const loading = ref(false)
const searchQuery = ref(props.initialSearch || '')
const filterType = ref('')
const sortBy = ref('createdAt')
const viewMode = ref('list')
const itemsPerPage = ref(10)
const selectedTags = ref<number[]>([])

// Dialogs
const showUploadDialog = ref(false)
const showPreviewDialog = ref(false)
const selectedDocument = ref(null)

// Data
const documents = ref<any[]>([])
const nextPageToken = ref<string>('')
const totalCount = ref(0)

const availableTags = ref(['report', 'financial', 'product', 'data', 'analytics', '2023', '2024'])

const documentTypes = ref([
  { title: 'PDF', value: 'pdf' },
  { title: 'Word Document', value: 'docx' },
  { title: 'Spreadsheet', value: 'csv' },
  { title: 'Text', value: 'txt' },
  { title: 'Image', value: 'image' }
])

const sortOptions = ref([
  { title: 'Date Created', value: 'createdAt' },
  { title: 'Name', value: 'name' },
  { title: 'Size', value: 'size' },
  { title: 'Type', value: 'type' }
])

const headers = ref<Array<{ title: string; key: string; sortable: boolean; align?: 'start' | 'end' | 'center' }>>([
  { title: 'Name', key: 'name', sortable: true },
  { title: 'Type', key: 'type', sortable: true },
  { title: 'Size', key: 'size', sortable: true },
  { title: 'Created', key: 'createdAt', sortable: true },
  { title: 'Tags', key: 'tags', sortable: false },
  { title: 'Actions', key: 'actions', sortable: false, align: 'end' }
])

// Methods
const debouncedSearch = debounce(() => {
  performSearch()
}, 500)

const performSearch = async () => {
  loading.value = true
  emit('search-update', searchQuery.value)
  
  try {
    await loadDocuments()
  } catch (error: any) {
    console.error('Search failed:', error)
    showNotification('Search failed', 'error')
  } finally {
    loading.value = false
  }
}

const viewDocument = (doc: any) => {
  selectedDocument.value = doc
  showPreviewDialog.value = true
}

const downloadDocument = (doc: any) => {
  // TODO: Implement download from S3
  showNotification(`Downloading ${doc.name}...`, 'info')
}

const deleteDocument = async (doc: any) => {
  try {
    await deletePipeDoc(doc.storageId || doc.id)
    showNotification(`Document ${doc.name} deleted`, 'success')
    await loadDocuments()
  } catch (error: any) {
    console.error('Failed to delete document:', error)
    showNotification(`Failed to delete: ${error.message}`, 'error')
  }
}

const onDocumentUploaded = async (_doc: any) => {
  showNotification('Document uploaded successfully', 'success')
  // Reload documents to show the new upload
  await loadDocuments()
}

// Simple chunk upload demo: sends a small text as two chunks
const openChunkUpload = async () => {
  try {
    const transport = createConnectTransport({
      baseUrl: window.location.origin,
      useBinaryFormat: true
    })
    const client = createClient(NodeUploadService as any, transport) as any
    const init: any = await client.initiateUpload({
      drive: 'modules-drive',
      parentId: '',
      name: `demo-${Date.now()}.txt`,
      metadata: {},
      expectedSize: BigInt(24),
      mimeType: 'text/plain',
    })
    showNotification(`Initiated chunk upload: ${init.nodeId}`, 'info')

    async function* makeRequests() {
      const part1 = new TextEncoder().encode('hello chunk ')
      const part2 = new TextEncoder().encode('upload test')
      yield { nodeId: init.nodeId, uploadId: init.uploadId, data: part1, chunkNumber: BigInt(1), isLast: false }
      yield { nodeId: init.nodeId, uploadId: init.uploadId, data: part2, chunkNumber: BigInt(2), isLast: true }
    }

    await client.uploadChunks(makeRequests() as any)
    showNotification('Chunk upload sent. Watch for completion...', 'success')
  } catch (e: any) {
    console.error(e)
    showNotification(`Chunk upload failed: ${e?.message || e}`, 'error')
  }
}

// Utility functions
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
}

const formatDate = (date: Date): string => {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(date)
}

const getFileIcon = (type: string): string => {
  const icons: Record<string, string> = {
    pdf: 'mdi-file-pdf-box',
    docx: 'mdi-file-word',
    csv: 'mdi-file-excel',
    txt: 'mdi-file-document',
    image: 'mdi-file-image'
  }
  return icons[type] || 'mdi-file'
}

const getFileColor = (type: string): string => {
  const colors: Record<string, string> = {
    pdf: 'red',
    docx: 'blue',
    csv: 'green',
    txt: 'grey',
    image: 'orange'
  }
  return colors[type] || 'grey'
}

// Watch for external search updates
watch(() => props.initialSearch, (newVal) => {
  searchQuery.value = newVal || ''
  performSearch()
})

// Load documents from repository
const loadDocuments = async () => {
  try {
    loading.value = true
    const response = await listPipeDocs(
      itemsPerPage.value,
      nextPageToken.value,
      searchQuery.value || undefined
    )
    
    // Transform stored documents to display format
    documents.value = response.documents.map(stored => ({
      id: stored.storageId,
      storageId: stored.storageId,
      name: stored.document?.source?.path || 'Unnamed Document',
      type: getFileTypeFromMime(stored.document?.source?.mimeType),
      size: Number(stored.document?.source?.size || 0),
      createdAt: new Date(stored.createdAt?.seconds * 1000 || Date.now()),
      tags: stored.tags?.tags || [],
      description: stored.description || ''
    }))
    
    nextPageToken.value = response.nextPageToken
    totalCount.value = response.totalCount
    
    // Update available tags from loaded documents
    const allTags = new Set<string>()
    documents.value.forEach(doc => {
      doc.tags.forEach((tag: string) => allTags.add(tag))
    })
    availableTags.value = Array.from(allTags)
  } catch (error: any) {
    console.error('Failed to load documents:', error)
    showNotification('Failed to load documents', 'error')
    documents.value = []
  } finally {
    loading.value = false
  }
}

// Helper to get file type from MIME type
const getFileTypeFromMime = (mimeType?: string): string => {
  if (!mimeType) return 'unknown'
  if (mimeType.includes('pdf')) return 'pdf'
  if (mimeType.includes('word')) return 'docx'
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return 'csv'
  if (mimeType.includes('text')) return 'txt'
  if (mimeType.includes('image')) return 'image'
  return mimeType.split('/')[1] || 'unknown'
}

// Load documents on mount
onMounted(() => {
  loadDocuments()
})
</script>