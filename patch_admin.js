import fs from 'fs';
import path from 'path';

const filePath = '/home/aman-kuril/Desktop/projects2/Appzeto-Master1/Frontend/src/modules/Food/pages/admin/system/LandingPageManagement.jsx';
let content = fs.readFileSync(filePath, 'utf8');

// 1. Add state
const stateBlock = `
  // Top Banners
  const [topBanners, setTopBanners] = useState([])
  const [topBannersLoading, setTopBannersLoading] = useState(true)
  const [topBannersUploading, setTopBannersUploading] = useState(false)
  const [topBannersUploadProgress, setTopBannersUploadProgress] = useState({ current: 0, total: 0 })
  const [topBannersDeleting, setTopBannersDeleting] = useState(null)
  const topBannersFileInputRef = useRef(null)

  // Hero Banners`;
content = content.replace('  // Hero Banners', stateBlock);

// 2. Add useEffect fetch call
const effectBlock = `
    fetchTopBanners()
    fetchBanners()`;
content = content.replace('    fetchBanners()', effectBlock);

// 3. Add methods (just copy Hero Banners and replace banners with topBanners)
// Hero banners methods are around line 161 (// ==================== HERO BANNERS ====================)
// We'll insert Top Banners methods right before it.

const topBannerMethods = `
  // ==================== TOP BANNERS ====================
  const fetchTopBanners = async () => {
    try {
      setTopBannersLoading(true)
      setError(null)
      const response = await api.get('/food/top-banners', getAuthConfig())
      if (response.data.success) {
        setTopBanners(response.data.data.banners || [])
      }
    } catch (err) {
      if (err.response?.status === 401) {
        setTopBanners([])
        setError(null)
      } else if (err.response?.status === 404) {
        setTopBanners([])
        setError(null)
      } else {
        setErrorSafely(err.response?.data?.message || 'Failed to load top banners')
      }
    } finally {
      setTopBannersLoading(false)
    }
  }

  const handleTopBannerFileSelect = (e) => {
    const files = Array.from(e.target?.files || e.files || [])
    if (files.length === 0) return
    if (files.length > 5) {
      setError('You can upload a maximum of 5 images at once')
      return
    }
    uploadTopBanners(files)
  }

  const uploadTopBanners = async (files) => {
    try {
      const adminToken = getModuleToken('admin')
      if (!adminToken || adminToken.trim() === '' || adminToken === 'null' || adminToken === 'undefined') {
        setErrorSafely('Authentication required. Please login again.')
        return
      }

      setTopBannersUploading(true)
      setError(null)
      setSuccess(null)
      setTopBannersUploadProgress({ current: 0, total: files.length })

      const formData = new FormData()
      files.forEach((file) => {
        formData.append('files', file)
      })

      const config = getAuthConfig()
      const response = await api.post('/food/top-banners/multiple', formData, config)

      if (response.data.success) {
        const uploadedBanners = response.data.data?.banners || []
        const errors = response.data.data?.errors || []
        const successCount = uploadedBanners.length
        const failCount = errors.length

        await fetchTopBanners()
        if (topBannersFileInputRef.current) topBannersFileInputRef.current.value = ''

        if (failCount === 0) {
          setSuccess(\`\${successCount} top banner\${successCount > 1 ? 's' : ''} uploaded successfully!\`)
          setTimeout(() => setSuccess(null), 5000)
        } else if (successCount > 0) {
          setSuccess(\`\${successCount} banner\${successCount > 1 ? 's' : ''} uploaded, \${failCount} failed.\`)
          setErrorSafely(errors.join(', '))
          setTimeout(() => { setSuccess(null); setError(null) }, 5000)
        } else {
          setErrorSafely(\`Failed to upload banners. \${errors.join(', ')}\`)
        }
      } else {
        setErrorSafely(response.data.message || 'Failed to upload banners')
      }

      setTopBannersUploadProgress({ current: 0, total: 0 })
    } catch (err) {
      if (err.response?.status === 401 || err.message === 'Authentication token not found') {
        setError(null)
      } else {
        setErrorSafely(err.response?.data?.message || 'Failed to upload banners')
      }
      setTopBannersUploadProgress({ current: 0, total: 0 })
    } finally {
      setTopBannersUploading(false)
    }
  }

  const handleDeleteTopBanner = async (id) => {
    if (!window.confirm('Are you sure you want to delete this top banner?')) return
    try {
      setTopBannersDeleting(id)
      setError(null)
      setSuccess(null)
      const response = await api.delete(\`/food/top-banners/\${id}\`, getAuthConfig())
      if (response.data.success) {
        setSuccess('Top banner deleted successfully!')
        await fetchTopBanners()
        setTimeout(() => setSuccess(null), 3000)
      }
    } catch (err) {
      setErrorSafely(err.response?.data?.message || 'Failed to delete banner.')
    } finally {
      setTopBannersDeleting(null)
    }
  }

  const handleToggleTopBannerStatus = async (id, currentStatus) => {
    try {
      setError(null)
      setSuccess(null)
      const response = await api.patch(\`/food/top-banners/\${id}/status\`, {}, getAuthConfig())
      if (response.data.success) {
        setSuccess(\`Banner \${currentStatus ? 'deactivated' : 'activated'} successfully!\`)
        await fetchTopBanners()
        setTimeout(() => setSuccess(null), 3000)
      }
    } catch (err) {
      setErrorSafely(err.response?.data?.message || 'Failed to update banner status.')
    }
  }

  const handleTopBannerOrderChange = async (id, direction) => {
    const banner = topBanners.find(b => b._id === id)
    if (!banner) return
    const newOrder = direction === 'up' ? banner.order - 1 : banner.order + 1
    const otherBanner = topBanners.find(b => b.order === newOrder && b._id !== id)
    if (!otherBanner && newOrder < 0) return
    try {
      setError(null)
      await api.patch(\`/food/top-banners/\${id}/order\`, { order: newOrder }, getAuthConfig())
      if (otherBanner) {
        await api.patch(\`/food/top-banners/\${otherBanner._id}/order\`, { order: banner.order }, getAuthConfig())
      }
      await fetchTopBanners()
    } catch (err) {
      setErrorSafely('Failed to update banner order.')
    }
  }

  // ==================== HERO BANNERS ====================`;

content = content.replace('  // ==================== HERO BANNERS ====================', topBannerMethods);

// 4. Update Tabs array
const tabsBlock = `
  const tabs = [
    { id: 'top-banners', label: 'Top Banners', icon: ImageIcon },
    { id: 'banners', label: 'Hero Banners', icon: ImageIcon },`;
content = content.replace(`  const tabs = [
    { id: 'banners', label: 'Hero Banners', icon: ImageIcon },`, tabsBlock);

// 5. Add UI block
const uiBlockTemplate = content.substring(content.indexOf(`{activeTab === 'banners' && (`), content.indexOf(`{activeTab === 'under-250' && (`));
let topBannerUI = uiBlockTemplate
  .replace(/{activeTab === 'banners'/g, "{activeTab === 'top-banners'")
  .replace(/bannersFileInputRef/g, "topBannersFileInputRef")
  .replace(/handleBannerFileSelect/g, "handleTopBannerFileSelect")
  .replace(/bannersUploading/g, "topBannersUploading")
  .replace(/bannersUploadProgress/g, "topBannersUploadProgress")
  .replace(/bannersLoading/g, "topBannersLoading")
  .replace(/bannersDeleting/g, "topBannersDeleting")
  .replace(/handleBannerOrderChange/g, "handleTopBannerOrderChange")
  .replace(/handleToggleBannerStatus/g, "handleToggleTopBannerStatus")
  .replace(/handleDeleteBanner/g, "handleDeleteTopBanner")
  // Replace references to `banners.` and `banners.length` and `banners.map` with `topBanners.`
  .replace(/banners\.length/g, "topBanners.length")
  .replace(/banners\.map/g, "topBanners.map")
  .replace(/const banner of banners/g, "const banner of topBanners")
  // Need to be careful here, so we do targeted replaces:
  .replace(/Upload New Banner\(s\)/g, "Upload New Top Banner(s) (800x680 pixels)");

// Top banner list
topBannerUI = topBannerUI.replace(/Banner List/g, "Top Banner List");
// Top Banner image alt
topBannerUI = topBannerUI.replace(/Hero Banner \${index \+ 1}/g, "Top Banner ${index + 1}");

// The Megaphone code inside banners is commented out, but we don't need it.

content = content.replace(`{activeTab === 'banners' && (`, topBannerUI + `\n        {activeTab === 'banners' && (`);

// Change initial active tab to top-banners
content = content.replace("const [activeTab, setActiveTab] = useState('banners')", "const [activeTab, setActiveTab] = useState('top-banners')");

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully patched LandingPageManagement.jsx');
