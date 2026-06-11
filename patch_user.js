import fs from 'fs';
import path from 'path';

const homePath = '/home/aman-kuril/Desktop/projects2/Appzeto-Master1/Frontend/src/modules/Food/pages/user/Home.jsx';
const headerPath = '/home/aman-kuril/Desktop/projects2/Appzeto-Master1/Frontend/src/modules/Food/components/user/home/HomeHeader.jsx';

// ================= Home.jsx =================
let homeContent = fs.readFileSync(homePath, 'utf8');

// 1. Add topBanners state
const stateBlock = `
  const [currentBannerIndex, setCurrentBannerIndex] = useState(0);
  const [topBannersData, setTopBannersData] = useState([]);`;
homeContent = homeContent.replace('  const [currentBannerIndex, setCurrentBannerIndex] = useState(0);', stateBlock);

// 2. Add fetch logic in useEffect
const effectContent = `
    const fetchTopBanners = async () => {
      try {
        const response = await api.get('/food/top-banners/public', {
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Expires': '0'
          }
        });
        if (response.data.success && Array.isArray(response.data.data?.banners)) {
          setTopBannersData(response.data.data.banners);
        }
      } catch (error) {
        console.error('Error fetching top banners:', error);
      }
    };
    
    fetchTopBanners();
    const fetchLandingData = async () => {`;
homeContent = homeContent.replace('    const fetchLandingData = async () => {', effectContent);

// 3. Pass topBannersData to HomeHeader
homeContent = homeContent.replace('<HomeHeader', '<HomeHeader topBanners={topBannersData}');

fs.writeFileSync(homePath, homeContent, 'utf8');
console.log('Successfully patched Home.jsx');


// ================= HomeHeader.jsx =================
let headerContent = fs.readFileSync(headerPath, 'utf8');

// 1. Add topBanners to props
headerContent = headerContent.replace(
  'isCategoryStuck = false,',
  'isCategoryStuck = false,\n  topBanners = [],'
);

// 2. Map topBanners to dynamicSlideBanners inside HomeHeader
// After slideBanners definition
const slidesReplacement = `
  ];

  const displayBanners = topBanners && topBanners.length > 0 
    ? topBanners.map((banner, index) => ({
        id: index,
        bg: "bg-gray-100 dark:bg-gray-800",
        content: (
          <img 
            src={banner.image || banner.imageUrl} 
            alt={\`Banner \${index + 1}\`} 
            className="absolute inset-0 w-full h-full object-cover" 
          />
        )
      }))
    : slideBanners;

  return (`;
headerContent = headerContent.replace('  ];\n\n  return (', slidesReplacement);

// 3. Replace slideBanners.length with displayBanners.length in handleTouchEnd
headerContent = headerContent.replace(/slideBanners\.length/g, 'displayBanners.length');

// 4. Update the render map
headerContent = headerContent.replace(/slideBanners\.map/g, 'displayBanners.map');

// 5. In displayBanners map, remove padding/flex classes from the container if using dynamic banners
const bannerRenderStr = `<div className="absolute inset-x-0 bottom-6 h-[140px] px-2 flex flex-col justify-end">
                {banner.content}
              </div>`;
const newBannerRenderStr = `
              {banner.content}
              {/* Only render this wrapper for static banners, dynamic ones are full cover */}
              {(!topBanners || topBanners.length === 0) && (
                <div className="absolute inset-x-0 bottom-6 h-[140px] px-2 flex flex-col justify-end pointer-events-none">
                  {banner.content}
                </div>
              )}`;

headerContent = headerContent.replace(bannerRenderStr, newBannerRenderStr);
// The dynamic banner sets content as \`<img ... />\`, we can just render \`{banner.content}\` for dynamic,
// but wait, the static ones also have \`content\`.
// Actually, it's simpler:
const simpleBannerRenderStr = `
              {topBanners && topBanners.length > 0 ? (
                banner.content
              ) : (
                <div className="absolute inset-x-0 bottom-6 h-[140px] px-2 flex flex-col justify-end pointer-events-none">
                  {banner.content}
                </div>
              )}`;
headerContent = headerContent.replace(newBannerRenderStr, simpleBannerRenderStr);

fs.writeFileSync(headerPath, headerContent, 'utf8');
console.log('Successfully patched HomeHeader.jsx');
