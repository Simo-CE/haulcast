from django.urls import path

from trips import views

urlpatterns = [
    path("api/health", views.health),
    path("api/analyze", views.analyze_trip),
    path("api/geocode", views.geocode_suggestions),
]
