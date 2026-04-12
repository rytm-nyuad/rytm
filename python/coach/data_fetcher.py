"""
Data fetch module - retrieves raw data from Supabase tables
"""
import os
from datetime import datetime, timedelta, date
from typing import Dict, List, Any, Optional
from supabase import create_client, Client

class DataFetcher:
    def __init__(self, supabase_url: str, supabase_key: str):
        self.client: Client = create_client(supabase_url, supabase_key)
    
    def fetch_daily_overall(self, user_id: str, target_date: date) -> Optional[Dict[str, Any]]:
        """Fetch daily overall score"""
        result = self.client.table('daily_overall') \
            .select('*') \
            .eq('user_id', user_id) \
            .eq('date', target_date.isoformat()) \
            .execute()
        return result.data[0] if result.data else None
    
    def fetch_daily_checkin(self, user_id: str, target_date: date) -> Optional[Dict[str, Any]]:
        """Fetch daily check-in data"""
        result = self.client.table('daily_checkins') \
            .select('*') \
            .eq('user_id', user_id) \
            .eq('checkin_date', target_date.isoformat()) \
            .execute()
        return result.data[0] if result.data else None
    
    def fetch_fitbit_sleep(self, user_id: str, target_date: date) -> Optional[Dict[str, Any]]:
        """Fetch Fitbit sleep data"""
        result = self.client.table('fitbit_sleep_daily') \
            .select('*') \
            .eq('app_user_id', user_id) \
            .eq('date', target_date.isoformat()) \
            .execute()
        return result.data[0] if result.data else None
    
    def fetch_fitbit_activity(self, user_id: str, target_date: date) -> Optional[Dict[str, Any]]:
        """Fetch Fitbit activity data"""
        result = self.client.table('fitbit_activity_daily') \
            .select('*') \
            .eq('app_user_id', user_id) \
            .eq('date', target_date.isoformat()) \
            .execute()
        return result.data[0] if result.data else None
    
    def fetch_fitbit_hrv(self, user_id: str, target_date: date) -> Optional[Dict[str, Any]]:
        """Fetch Fitbit HRV data"""
        result = self.client.table('fitbit_hrv_daily') \
            .select('*') \
            .eq('app_user_id', user_id) \
            .eq('date', target_date.isoformat()) \
            .execute()
        return result.data[0] if result.data else None
    
    def fetch_fitbit_readiness(self, user_id: str, target_date: date) -> Optional[Dict[str, Any]]:
        """Fetch Fitbit readiness data"""
        result = self.client.table('fitbit_readiness_daily') \
            .select('*') \
            .eq('app_user_id', user_id) \
            .eq('date', target_date.isoformat()) \
            .execute()
        return result.data[0] if result.data else None
    
    def fetch_fitbit_overnight(self, user_id: str, target_date: date) -> Optional[Dict[str, Any]]:
        """Fetch Fitbit overnight metrics"""
        result = self.client.table('fitbit_overnight_daily') \
            .select('*') \
            .eq('app_user_id', user_id) \
            .eq('date', target_date.isoformat()) \
            .execute()
        return result.data[0] if result.data else None
    
    def fetch_water_intake(self, user_id: str, target_date: date) -> List[Dict[str, Any]]:
        """Fetch water intake logs for a day"""
        result = self.client.table('water_intake_logs') \
            .select('*') \
            .eq('user_id', user_id) \
            .gte('intake_datetime', f"{target_date.isoformat()}T00:00:00") \
            .lt('intake_datetime', f"{(target_date + timedelta(days=1)).isoformat()}T00:00:00") \
            .execute()
        return result.data or []
    
    def fetch_meal_logs(self, user_id: str, target_date: date) -> List[Dict[str, Any]]:
        """Fetch meal logs for a day"""
        result = self.client.table('meal_logs') \
            .select('*') \
            .eq('user_id', user_id) \
            .gte('meal_datetime', f"{target_date.isoformat()}T00:00:00") \
            .lt('meal_datetime', f"{(target_date + timedelta(days=1)).isoformat()}T00:00:00") \
            .execute()
        return result.data or []
    
    def fetch_todos(self, user_id: str, target_date: date) -> List[Dict[str, Any]]:
        """Fetch todos for a day"""
        result = self.client.table('daily_todos') \
            .select('*') \
            .eq('user_id', user_id) \
            .eq('date', target_date.isoformat()) \
            .execute()
        return result.data or []
    
    def fetch_calendar_events(self, user_id: str, target_date: date) -> List[Dict[str, Any]]:
        """Fetch calendar events for a day"""
        result = self.client.table('calendar_events') \
            .select('*') \
            .eq('app_user_id', user_id) \
            .gte('start_time', f"{target_date.isoformat()}T00:00:00") \
            .lt('start_time', f"{(target_date + timedelta(days=1)).isoformat()}T00:00:00") \
            .execute()
        return result.data or []
    
    def fetch_7d_history(self, user_id: str, end_date: date) -> Dict[str, List[Dict[str, Any]]]:
        """Fetch 7-day history for baseline calculations"""
        start_date = end_date - timedelta(days=7)
        
        return {
            'checkins': self._fetch_checkins_range(user_id, start_date, end_date),
            'sleep': self._fetch_sleep_range(user_id, start_date, end_date),
            'hrv': self._fetch_hrv_range(user_id, start_date, end_date),
            'activity': self._fetch_activity_range(user_id, start_date, end_date),
            'readiness': self._fetch_readiness_range(user_id, start_date, end_date),
        }
    
    def _fetch_checkins_range(self, user_id: str, start_date: date, end_date: date) -> List[Dict]:
        result = self.client.table('daily_checkins') \
            .select('*') \
            .eq('user_id', user_id) \
            .gte('checkin_date', start_date.isoformat()) \
            .lte('checkin_date', end_date.isoformat()) \
            .order('checkin_date') \
            .execute()
        return result.data or []
    
    def _fetch_sleep_range(self, user_id: str, start_date: date, end_date: date) -> List[Dict]:
        result = self.client.table('fitbit_sleep_daily') \
            .select('*') \
            .eq('app_user_id', user_id) \
            .gte('date', start_date.isoformat()) \
            .lte('date', end_date.isoformat()) \
            .order('date') \
            .execute()
        return result.data or []
    
    def _fetch_hrv_range(self, user_id: str, start_date: date, end_date: date) -> List[Dict]:
        result = self.client.table('fitbit_hrv_daily') \
            .select('*') \
            .eq('app_user_id', user_id) \
            .gte('date', start_date.isoformat()) \
            .lte('date', end_date.isoformat()) \
            .order('date') \
            .execute()
        return result.data or []
    
    def _fetch_activity_range(self, user_id: str, start_date: date, end_date: date) -> List[Dict]:
        result = self.client.table('fitbit_activity_daily') \
            .select('*') \
            .eq('app_user_id', user_id) \
            .gte('date', start_date.isoformat()) \
            .lte('date', end_date.isoformat()) \
            .order('date') \
            .execute()
        return result.data or []
    
    def _fetch_readiness_range(self, user_id: str, start_date: date, end_date: date) -> List[Dict]:
        result = self.client.table('fitbit_readiness_daily') \
            .select('*') \
            .eq('app_user_id', user_id) \
            .gte('date', start_date.isoformat()) \
            .lte('date', end_date.isoformat()) \
            .order('date') \
            .execute()
        return result.data or []
    
    def fetch_user_profile(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Fetch user profile (name, timezone)"""
        result = self.client.table('profiles') \
            .select('user_id, first_name, last_name, timezone') \
            .eq('user_id', user_id) \
            .execute()
        return result.data[0] if result.data else None

    def fetch_recent_actions(self, user_id: str, end_date: date, lookback_days: int = 7) -> List[Dict[str, Any]]:
        """Fetch recent plan actions for variety/deduplication"""
        start_date = end_date - timedelta(days=lookback_days)
        result = self.client.table('plan_actions1') \
            .select('action_id, domain, priority, effort_level, reason, for_date') \
            .eq('user_id', user_id) \
            .gte('for_date', start_date.isoformat()) \
            .lt('for_date', end_date.isoformat()) \
            .order('for_date', desc=True) \
            .execute()
        return result.data or []

    def fetch_all_daily_data(self, user_id: str, target_date: date) -> Dict[str, Any]:
        """Fetch all data sources for a given day"""
        return {
            'overall': self.fetch_daily_overall(user_id, target_date),
            'checkin': self.fetch_daily_checkin(user_id, target_date),
            'sleep': self.fetch_fitbit_sleep(user_id, target_date),
            'activity': self.fetch_fitbit_activity(user_id, target_date),
            'hrv': self.fetch_fitbit_hrv(user_id, target_date),
            'readiness': self.fetch_fitbit_readiness(user_id, target_date),
            'overnight': self.fetch_fitbit_overnight(user_id, target_date),
            'water': self.fetch_water_intake(user_id, target_date),
            'meals': self.fetch_meal_logs(user_id, target_date),
            'todos': self.fetch_todos(user_id, target_date),
            'calendar': self.fetch_calendar_events(user_id, target_date),
            'history_7d': self.fetch_7d_history(user_id, target_date)
        }
