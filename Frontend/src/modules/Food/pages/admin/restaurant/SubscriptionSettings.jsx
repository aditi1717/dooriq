import React, { useState, useEffect } from 'react';
import { adminAPI } from '@/services/api';
import { Button } from '@food/components/ui/button';
import { Input } from '@food/components/ui/input';
import { Label } from '@food/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@food/components/ui/card';
import { toast } from "sonner";
import { Loader2, Save, CreditCard, Award, Rocket, TrendingUp, BarChart3 } from "lucide-react";

const SubscriptionSettings = () => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [featureEnabled, setFeatureEnabled] = useState(true);
    const [settings, setSettings] = useState({
        starterPrice: 999,
        growthPrice: 1999,
        premiumPrice: 2999,
        starterMinGmv: 0,
        starterMaxGmv: 30000,
        growthMinGmv: 30000.01,
        growthMaxGmv: 60000,
        premiumMinGmv: 60000.01,
        onboardingFee: 799
    });

    useEffect(() => {
        fetchSettings();
    }, []);

    const fetchSettings = async () => {
        try {
            setLoading(true);
            const res = await adminAPI.getRestaurantSubscriptionSettings();
            try {
                const featureRes = await adminAPI.getFeatureSettings();
                const featureRows = Array.isArray(featureRes?.data?.data) ? featureRes.data.data : [];
                const feature = featureRows.find((row) => row.key === 'restaurant_subscription');
                if (feature) setFeatureEnabled(Boolean(feature.isEnabled));
            } catch (_featureError) {
                // Sub-admins without system_settings permission can still manage subscription settings.
                // Keep feature enabled by default if this call is forbidden.
                setFeatureEnabled(true);
            }
            if (res.data?.success && res.data.data) {
                const data = res.data.data;
                setSettings({
                    starterPrice: Number(data?.starterPrice ?? 999),
                    growthPrice: Number(data?.growthPrice ?? 1999),
                    premiumPrice: Number(data?.premiumPrice ?? 2999),
                    starterMinGmv: Number(data?.starterMinGmv ?? 0),
                    starterMaxGmv: Number(data?.starterMaxGmv ?? 30000),
                    growthMinGmv: Number(data?.growthMinGmv ?? 30000.01),
                    growthMaxGmv: Number(data?.growthMaxGmv ?? 60000),
                    premiumMinGmv: Number(data?.premiumMinGmv ?? 60000.01),
                    onboardingFee: Number(data?.onboardingFee ?? 799),
                });
            }
        } catch (error) {
            console.error('Error fetching settings:', error);
            toast.error("Failed to load subscription settings.");
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!featureEnabled) {
            toast.error('Restaurant Subscription feature is disabled. Enable it from Feature Settings first.');
            return;
        }
        try {
            setSaving(true);
            const res = await adminAPI.updateRestaurantSubscriptionSettings(settings);
            if (res.data?.success) {
                toast.success("Subscription settings updated successfully.");
            }
        } catch (error) {
            console.error('Error saving settings:', error);
            toast.error("Failed to update subscription settings.");
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex h-[400px] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="p-6 space-y-6 max-w-4xl mx-auto">
            <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-gray-900">Restaurant Subscription Settings</h1>
                <p className="text-gray-500">Manage the pricing for restaurant subscription plans and onboarding fees.</p>
                {!featureEnabled ? (
                    <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                        This section is currently disabled by Feature Settings.
                    </p>
                ) : null}
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <Card className="border-slate-200 shadow-sm overflow-hidden border-l-4 border-l-slate-400">
                    <CardHeader className="bg-slate-50/50 pb-4">
                        <div className="flex items-center gap-2">
                            <Award className="h-5 w-5 text-slate-600" />
                            <CardTitle className="text-lg">Starter Plan</CardTitle>
                        </div>
                        <CardDescription>For GMV from ₹0 to Starter Max GMV</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6">
                        <div className="space-y-2">
                            <Label htmlFor="starterPrice">Monthly Price (₹)</Label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">₹</span>
                                <Input
                                    id="starterPrice"
                                    type="number"
                                    min="0"
                                    className="pl-7"
                                    value={settings.starterPrice}
                                    onChange={(e) => setSettings({ ...settings, starterPrice: Math.max(0, Number(e.target.value)) })}
                                />
                            </div>
                            <p className="text-xs text-gray-400 italic">GST (18%) will be added automatically on the onboarding page.</p>
                            <div className="grid grid-cols-2 gap-2 pt-1">
                                <div className="space-y-1">
                                    <Label htmlFor="starterMinGmv">Starter Min GMV</Label>
                                    <Input
                                        id="starterMinGmv"
                                        type="number"
                                        min="0"
                                        value={settings.starterMinGmv}
                                        onChange={(e) => setSettings({ ...settings, starterMinGmv: Math.max(0, Number(e.target.value)) })}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="starterMaxGmv">Starter Max GMV</Label>
                                    <Input
                                        id="starterMaxGmv"
                                        type="number"
                                        min="0"
                                        value={settings.starterMaxGmv}
                                        onChange={(e) => setSettings({ ...settings, starterMaxGmv: Math.max(0, Number(e.target.value)) })}
                                    />
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-amber-200 shadow-sm overflow-hidden border-l-4 border-l-amber-400">
                    <CardHeader className="bg-amber-50/50 pb-4">
                        <div className="flex items-center gap-2">
                            <Award className="h-5 w-5 text-amber-600" />
                            <CardTitle className="text-lg">Growth Plan</CardTitle>
                        </div>
                        <CardDescription>For GMV above Starter Max and up to Growth Max</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6">
                        <div className="space-y-2">
                            <Label htmlFor="growthPrice">Monthly Price (₹)</Label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">₹</span>
                                <Input
                                    id="growthPrice"
                                    type="number"
                                    min="0"
                                    className="pl-7"
                                    value={settings.growthPrice}
                                    onChange={(e) => setSettings({ ...settings, growthPrice: Math.max(0, Number(e.target.value)) })}
                                />
                            </div>
                            <p className="text-xs text-gray-400 italic">GST (18%) will be added automatically on the onboarding page.</p>
                            <div className="grid grid-cols-2 gap-2 pt-1">
                                <div className="space-y-1">
                                    <Label htmlFor="growthMinGmv">Growth Min GMV</Label>
                                    <Input
                                        id="growthMinGmv"
                                        type="number"
                                        min="0"
                                        value={settings.growthMinGmv}
                                        onChange={(e) => setSettings({ ...settings, growthMinGmv: Math.max(0, Number(e.target.value)) })}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="growthMaxGmv">Growth Max GMV</Label>
                                    <Input
                                        id="growthMaxGmv"
                                        type="number"
                                        min="0"
                                        value={settings.growthMaxGmv}
                                        onChange={(e) => setSettings({ ...settings, growthMaxGmv: Math.max(0, Number(e.target.value)) })}
                                    />
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-emerald-200 shadow-sm overflow-hidden border-l-4 border-l-emerald-400">
                    <CardHeader className="bg-emerald-50/50 pb-4">
                        <div className="flex items-center gap-2">
                            <TrendingUp className="h-5 w-5 text-emerald-600" />
                            <CardTitle className="text-lg">Premium Plan</CardTitle>
                        </div>
                        <CardDescription>For GMV above Growth Max GMV</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6">
                        <div className="space-y-2">
                            <Label htmlFor="premiumPrice">Monthly Price (₹)</Label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">₹</span>
                                <Input
                                    id="premiumPrice"
                                    type="number"
                                    min="0"
                                    className="pl-7"
                                    value={settings.premiumPrice}
                                    onChange={(e) => setSettings({ ...settings, premiumPrice: Math.max(0, Number(e.target.value)) })}
                                />
                            </div>
                            <p className="text-xs text-gray-400 italic">GST (18%) will be added automatically on the onboarding page.</p>
                            <div className="space-y-1 pt-1">
                                <Label htmlFor="premiumMinGmv">Premium Min GMV</Label>
                                <Input
                                    id="premiumMinGmv"
                                    type="number"
                                    min="0"
                                    value={settings.premiumMinGmv}
                                    onChange={(e) => setSettings({ ...settings, premiumMinGmv: Math.max(0, Number(e.target.value)) })}
                                />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-indigo-200 shadow-sm overflow-hidden border-l-4 border-l-indigo-400 md:col-span-2">
                    <CardHeader className="bg-indigo-50/50 pb-4">
                        <div className="flex items-center gap-2">
                            <BarChart3 className="h-5 w-5 text-indigo-600" />
                            <CardTitle className="text-lg">GMV Slab Thresholds</CardTitle>
                        </div>
                        <CardDescription>Plan eligibility is auto-picked by last 30 days GMV.</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6 grid gap-4 md:grid-cols-2">
                        <p className="md:col-span-2 text-xs text-gray-500">
                            Effective slabs: Starter = ₹{Number(settings.starterMinGmv || 0).toFixed(2)} to ₹{Number(settings.starterMaxGmv || 0).toFixed(2)},
                            Growth = ₹{Number(settings.growthMinGmv || 0).toFixed(2)} to ₹{Number(settings.growthMaxGmv || 0).toFixed(2)},
                            Premium {">="} ₹{Number(settings.premiumMinGmv || 0).toFixed(2)}.
                        </p>
                    </CardContent>
                </Card>

                <Card className="border-blue-200 shadow-sm overflow-hidden border-l-4 border-l-blue-400 md:col-span-2">
                    <CardHeader className="bg-blue-50/50 pb-4">
                        <div className="flex items-center gap-2">
                            <Rocket className="h-5 w-5 text-blue-600" />
                            <CardTitle className="text-lg">Onboarding Fee</CardTitle>
                        </div>
                        <CardDescription>One-time mandatory setup fee for all new restaurants</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6">
                        <div className="grid gap-4 md:grid-cols-2 items-end">
                            <div className="space-y-2">
                                <Label htmlFor="onboardingFee">Setup Fee (₹)</Label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">₹</span>
                                    <Input
                                        id="onboardingFee"
                                        type="number"
                                        min="0"
                                        className="pl-7"
                                        value={settings.onboardingFee}
                                        onChange={(e) => setSettings({ ...settings, onboardingFee: Math.max(0, Number(e.target.value)) })}
                                    />
                                </div>
                            </div>
                            <div className="bg-blue-50 p-3 rounded-lg border border-blue-100">
                                <p className="text-sm text-blue-800 flex items-center gap-2">
                                    <CreditCard className="h-4 w-4" />
                                    Total Payable with GST: <strong>₹{Math.round(settings.onboardingFee * 1.18)}</strong>
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="flex justify-end pt-4">
                <Button 
                    onClick={handleSave} 
                    disabled={saving}
                    className="w-full md:w-auto min-w-[150px]"
                >
                    {saving ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Saving...
                        </>
                    ) : (
                        <>
                            <Save className="mr-2 h-4 w-4" />
                            Save Changes
                        </>
                    )}
                </Button>
            </div>
        </div>
    );
};

export default SubscriptionSettings;
