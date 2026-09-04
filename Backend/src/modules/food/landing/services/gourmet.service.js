import { FoodGourmetRestaurant } from '../models/gourmetRestaurant.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import {
    filterRestaurantsByRoadRadius,
    getDefaultServingRadiusKm,
} from '../../shared/restaurantVisibility.service.js';

export const getPublicGourmetRestaurants = async (_zoneId, lat = null, lng = null) => {
    const docs = await FoodGourmetRestaurant.find({ isActive: true })
        .sort({ priority: 1, createdAt: -1 })
        .lean();

    const restaurantIds = docs.map((d) => d.restaurantId);
    
    const query = { _id: { $in: restaurantIds }, status: 'approved' };

    const restaurants = await FoodRestaurant.find(query)
        .select('restaurantName area city profileImage rating cuisines slug pureVegRestaurant location estimatedDeliveryTime zoneId')
        .lean();

    const userLat = lat !== null ? Number(lat) : null;
    const userLng = lng !== null ? Number(lng) : null;
    const wantsGeo = userLat !== null && !isNaN(userLat) && userLng !== null && !isNaN(userLng);

    let filteredRestaurants = restaurants;
    if (wantsGeo) {
        filteredRestaurants = await filterRestaurantsByRoadRadius(
            restaurants,
            { lat: userLat, lng: userLng },
            {
                radiusKm: await getDefaultServingRadiusKm(),
            }
        );
    }

    const restaurantMap = new Map(filteredRestaurants.map((r) => [r._id.toString(), r]));

    return docs.map((item) => {
        const r = restaurantMap.get(item.restaurantId.toString());
        return {
            ...item,
            restaurant: r ? {
                _id: r._id,
                name: r.restaurantName,
                restaurantName: r.restaurantName,
                rating: r.rating || 0,
                profileImage: r.profileImage ? { url: r.profileImage } : null,
                area: r.area,
                city: r.city,
                cuisines: r.cuisines || [],
                slug: r.slug,
                pureVegRestaurant: r.pureVegRestaurant,
                location: r.location,
                estimatedDeliveryTime: r.estimatedDeliveryTime,
                roadDistanceKm: null,
                distanceInKm: r.distanceScore ?? r.straightLineDistanceKm ?? null,
                zoneId: r.zoneId
            } : null
        };
    });
};

